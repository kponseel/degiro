/**
 * Service worker : orchestre la capture et l'envoi.
 *
 * C'est le seul endroit qui connaît le jeton de l'API. Il ne fait jamais de
 * requête vers DEGIRO lui-même : il demande au script de contenu de les
 * exécuter dans l'onglet, pour profiter de la session déjà authentifiée.
 *
 * Chaque étape est journalisée dans un rapport de diagnostic renvoyé au popup :
 * si DEGIRO change son format, on voit immédiatement quelle étape a lâché.
 */
import { buildPayload, parsePortfolio, productIds, chunk } from './degiro.js';
import {
  isComplete, intAccountFromClient, sessionIdFromConfig, urls,
} from './session.js';

const DEGIRO_TAB = 'https://trader.degiro.nl/*';
const isDegiro = (tab) => String(tab?.url || '').startsWith('https://trader.degiro.nl/');

/**
 * Retrouve l'onglet DEGIRO. L'extension ne demande pas la permission `tabs` :
 * elle ne voit donc que les onglets pour lesquels elle a une permission d'hôte,
 * c'est-à-dire DEGIRO et rien d'autre. Le repli sur une requête sans filtre
 * garde cette limite — les autres onglets remontent sans URL — et couvre le cas
 * où le filtre par motif ne rend rien.
 */
async function findTab() {
  let tabs = await chrome.tabs.query({ url: DEGIRO_TAB }).catch(() => []);
  if (!tabs.length) tabs = (await chrome.tabs.query({}).catch(() => [])).filter(isDegiro);
  return tabs.find((t) => t.active) || tabs[0] || null;
}

const ask = (tabId, message) => chrome.tabs.sendMessage(tabId, message);

/** Une requête DEGIRO passée par l'onglet, erreurs de messagerie comprises. */
const fetchViaTab = (tabId, url, extra = null) => ask(tabId, { type: 'FETCH', url, ...(extra || {}) })
  .catch((e) => ({ ok: false, status: 0, error: String(e.message || e) }));

/**
 * Appelle DEGIRO en renouvelant la session sur un 401.
 *
 * Les sessions DEGIRO sont courtes, et une expiration en plein milieu d'une
 * capture faisait tout échouer avec « reconnecte-toi » — alors que le cookie du
 * navigateur, lui, est toujours valable : seul le `sessionId` relevé au passage
 * avait vieilli. `/login/secure/config` en délivre un frais à la seule force de
 * ce cookie. Un seul renouvellement par capture : les appels suivants profitent
 * du jeton neuf, et un second 401 signale autre chose qu'une expiration.
 *
 * `construireUrl(sessionId)` : l'URL doit être RECONSTRUITE, le `sessionId` y
 * étant un paramètre.
 */
function makeDegiroFetch(tabId, creds) {
  // Tentatives de renouvellement, pas « renouvellement effectué » : marquer la
  // tentative comme consommée alors que la configuration n'a rien renvoyé (panne
  // passagère) brûlait l'unique reprise sans rien réparer. Deux essais au plus,
  // pour ne pas marteler des dizaines de fenêtres avec une session morte.
  let essais = 0;
  return async function degiroFetch(construireUrl, extra = null) {
    const res = await fetchViaTab(tabId, construireUrl(creds.sessionId), extra);
    if (res?.status !== 401 || essais >= 2) return res;
    essais += 1;
    const frais = await rafraichirSession(tabId);
    if (!frais || frais === creds.sessionId) return res;
    creds.sessionId = frais;
    return fetchViaTab(tabId, construireUrl(frais), extra);
  };
}

/** Demande un `sessionId` frais à DEGIRO (cookie de session seul). */
async function rafraichirSession(tabId) {
  const res = await fetchViaTab(tabId, urls.config());
  return res?.ok ? sessionIdFromConfig(res.json) : null;
}

/** Un pas de diagnostic : libellé, verdict, détail lisible. */
const step = (report, label, ok, detail) => {
  report.steps.push({ label, ok, detail });
  return ok;
};

async function capture() {
  const report = { steps: [], at: new Date().toISOString() };

  const tab = await findTab();
  if (!step(report, 'Onglet DEGIRO', Boolean(tab), tab ? tab.url.slice(0, 60) : 'aucun onglet trader.degiro.nl ouvert')) {
    return { ok: false, report, error: "Ouvre trader.degiro.nl et connecte-toi, puis relance la capture." };
  }

  let creds = {};
  try {
    creds = (await ask(tab.id, { type: 'GET_CREDS' }))?.creds || {};
  } catch (e) {
    // Chrome renvoie ici « Could not establish connection. Receiving end does
    // not exist. » — exact, mais opaque. Il signifie une seule chose en
    // pratique : l'onglet n'a pas de script de contenu, parce qu'il était déjà
    // ouvert quand l'extension a été installée ou rechargée. Chrome n'injecte
    // que dans les onglets ouverts ensuite. On explique plutôt que de recopier.
    const brut = String(e.message || e);
    const pasDeScript = /Receiving end does not exist|Could not establish connection/i.test(brut);
    step(report, 'Script de contenu', false, pasDeScript
      ? "l'onglet DEGIRO n'a pas encore le script de l'extension — il était ouvert avant son installation"
      : brut);
    return {
      ok: false,
      report,
      error: pasDeScript
        ? "Recharge l'onglet DEGIRO (F5), puis relance la capture. Chrome n'active l'extension que sur les onglets ouverts après son installation — et un onglet déjà ouvert perd le lien à chaque rechargement de l'extension."
        : "L'extension n'a pas pu parler à l'onglet DEGIRO. Recharge la page (F5) puis réessaie.",
    };
  }

  // Secours n°1 : sans `sessionId` relevé — l'application DEGIRO n'a encore
  // lancé aucun appel depuis l'ouverture de l'onglet — la configuration en
  // délivre un à la seule force du cookie de session. Sans cela, l'utilisateur
  // se voyait répondre « reste quelques secondes sur l'onglet » pour une page à
  // peine chargée, alors que sa session était parfaitement valable.
  if (!creds.sessionId) {
    const frais = await rafraichirSession(tab.id);
    if (frais) creds.sessionId = frais;
  }

  // Secours n°2 : `intAccount`, que la configuration ne donne pas, vient de
  // /pa/secure/client — qui répond lui aussi au seul cookie de session.
  if (creds.sessionId && !creds.intAccount) {
    const client = await fetchViaTab(tab.id, urls.client(creds.sessionId));
    const intAccount = client?.ok ? intAccountFromClient(client.json) : null;
    if (intAccount) creds.intAccount = intAccount;
  }

  if (!step(report, 'Session DEGIRO', isComplete(creds),
    isComplete(creds)
      ? `compte ${creds.intAccount}, session ${String(creds.sessionId).slice(0, 6)}…`
      : `manquant : ${[!creds.sessionId && 'sessionId', !creds.intAccount && 'intAccount'].filter(Boolean).join(', ')}`)) {
    return {
      ok: false,
      report,
      error: "Session DEGIRO introuvable. Reste sur l'onglet DEGIRO connecté quelques secondes (la page doit se rafraîchir une fois), puis relance.",
    };
  }

  // Toutes les lectures DEGIRO passent par ici : un 401 en cours de route
  // renouvelle la session au lieu de faire échouer la capture entière.
  const degiroFetch = makeDegiroFetch(tab.id, creds);

  const update = await degiroFetch((sid) => urls.update(creds.intAccount, sid));
  if (!step(report, 'Lecture du portefeuille', Boolean(update?.ok && update.json),
    update?.ok ? 'reçu' : `HTTP ${update?.status ?? '?'}${update?.error ? ` — ${update.error}` : ''}`)) {
    return { ok: false, report, error: update?.status === 401 ? 'Session DEGIRO expirée : reconnecte-toi puis réessaie.' : 'DEGIRO a refusé la lecture du portefeuille.' };
  }

  // Résolution des identifiants produit en ISIN, par lots de 100 — pour les
  // seules positions détenues : les lignes soldées ne sont plus envoyées.
  const { products } = parsePortfolio(update.json);
  const ids = [...new Set(productIds(products))];
  const lots = [];
  for (const batch of chunk(ids, 100)) {
    // Par degiroFetch comme les autres : c'était le seul appel DEGIRO privé de
    // reprise sur 401, et son échec laisse les positions sans ISIN — donc une
    // capture vide, alors que la session pouvait simplement être renouvelée.
    const res = await degiroFetch(
      (sid) => urls.productsInfo(creds.intAccount, sid),
      { method: 'POST', body: batch },
    );
    if (res?.ok && res.json) lots.push(res.json);
  }
  const resolved = lots.reduce((n, l) => n + Object.keys(l?.data || {}).length, 0);
  step(report, 'Résolution des ISIN', resolved > 0 || ids.length === 0, `${resolved}/${ids.length} produit(s)`);

  const { payload, diagnostics } = buildPayload({
    update: update.json,
    products: lots,
    captureId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
  });

  step(report, 'Positions retenues', payload.positions.length > 0,
    `${diagnostics.sent} envoyée(s) sur ${diagnostics.held} détenue(s)`
    + (diagnostics.skipped.length ? ` — ignorées faute d'ISIN : ${diagnostics.skipped.map((s) => s.name || s.productId).join(', ')}` : ''));

  // Le fonds de trésorerie tombe dans un angle mort du vocabulaire DEGIRO : son
  // API le compte dans les TITRES (`reportPortfValue`), son interface l'affiche
  // dans les LIQUIDITÉS (« EUR »). Le nommer explique d'un seul coup pourquoi
  // notre ligne « titres » est plus basse que celle de DEGIRO — faute de quoi
  // l'écart se redécouvre à l'œil à chaque capture, et se cherche là où il n'est
  // pas. Affiché dans les deux cas : c'est aussi vrai quand tout concorde.
  const fonds = Math.abs(diagnostics.fondsTresorerie || 0) > 1
    ? ` — dont fonds de trésorerie ${diagnostics.fondsTresorerie} €, que DEGIRO range dans ses titres et affiche dans ses liquidités`
    : '';

  // Sans ligne de trésorerie en euros, `buildPayload` annule le contrôle plutôt
  // que de le fausser. On le dit au lieu de faire disparaître l'étape : une
  // vérification absente doit se voir, sinon elle passe pour une vérification
  // réussie.
  if (diagnostics.totalGap === null && diagnostics.degiroTotal !== undefined) {
    step(report, 'Contrôle du total', true,
      `${diagnostics.degiroTotal} € selon DEGIRO — recoupement indépendant impossible,`
      + ' aucune ligne de trésorerie en euros lue');
  }

  // Détail par devise, en étape à part.
  //
  // Entassé dans la ligne du contrôle du total, il était illisible — et il
  // n'apparaissait qu'en cas d'écart, alors que c'est justement le chiffre qu'on
  // veut pouvoir vérifier quand tout semble aller. Le taux affiché est la
  // médiane des lignes de la devise ; la dispersion dit si elles s'accordent.
  if ((diagnostics.parDevise || []).length) {
    const parDevise = diagnostics.parDevise.map((d) => {
      const bloc = [`${d.devise} — ${d.lignes} ligne(s), ${d.valeur} €`];
      if (d.local !== null) bloc.push(`cours×qté ${d.local}`);
      if (d.taux !== null) bloc.push(`taux ${d.taux}`);
      if (!d.controlee) bloc.push('trop peu de lignes pour contrôler le taux');
      else bloc.push(`dispersion ${(d.dispersion * 100).toFixed(3)} %`);
      return bloc.join(', ');
    }).join(' | ');
    // Une dispersion nulle sur toutes les devises = toutes les lignes d'une même
    // devise partagent le même taux. Aucune ligne n'est donc mal convertie, et
    // un écart résiduel vient d'ailleurs.
    const accord = diagnostics.parDevise.every((d) => !d.controlee || d.dispersion <= 0.005);
    step(report, 'Détail par devise', accord, parDevise
      + (accord ? '' : ' — au moins une ligne est convertie à un taux différent des autres, voir les pistes ci-dessous'));
  }

  // Contrôle de cohérence : notre somme doit coller au total affiché par DEGIRO.
  if (diagnostics.totalGap !== null) {
    // `gapExplique` : le reliquat tient dans les soldes en devises que nous ne
    // savons pas convertir. Ce n'est pas une erreur de lecture, et l'annoncer
    // comme telle enverrait chercher un bug là où il n'y en a pas.
    const consistent = Math.abs(diagnostics.totalGap) <= 1 || diagnostics.gapExplique;
    // Les devises non converties sont la cause la plus fréquente d'un reliquat :
    // le dire évite de faire chercher une lecture fautive là où il n'y en a pas.
    const devises = (diagnostics.cashOther || [])
      .map((c) => `${c.value} ${c.currency}`).join(', ');
    // Décomposition titres / liquidités des deux côtés : un écart nu ne dit pas
    // s'il vient d'une position mal lue ou d'un solde mal compté.
    // Le nombre de positions RÉELLEMENT valorisées : si les 27 le sont et que
    // l'écart persiste, aucune ligne ne manque — c'est la valorisation ligne à
    // ligne qui diverge, et c'est une autre enquête que « il manque un titre ».
    // Le manque est rapporté aux TITRES seuls, fonds de trésorerie déduit : dire
    // « DEGIRO 79 993 € » alors que ce chiffre englobe le fonds envoyait chercher
    // 2 878 € là où il n'en manquait que 468.
    const manque = diagnostics.titresManquants;
    const detail = `titres ${diagnostics.positionsTotal} €`
      + (diagnostics.titresDegiro != null ? ` (DEGIRO ${diagnostics.titresDegiro} € hors fonds de trésorerie)` : '')
      + `, ${diagnostics.valued}/${diagnostics.held} position(s) valorisée(s)`
      + `, liquidités ${diagnostics.cash ?? '?'} € (source : ${diagnostics.cashSource}`
      + (diagnostics.cashEur != null ? `, nos lignes en euros : ${diagnostics.cashEur} €` : '') + ')'
      + (manque != null && Math.abs(manque) > 1
        ? ` — ${Math.abs(manque)} € de titres que DEGIRO compte et que nous ne trouvons sur aucune ligne`
        : '');
    // Les lignes suspectes sont nommées : un écart qui désigne son origine se
    // vérifie en dix secondes sur le site DEGIRO, un écart nu jamais.
    const pistes = (diagnostics.suspects || []).slice(0, 3).join(' ; ');
    // Ventilation par devise : sur une devise étrangère, « valeur » et
    // « cours × quantité » doivent différer du taux de change. S'ils sont égaux,
    // la valeur reçue est locale et comptée à tort comme des euros.
    const devisesDetail = '';
    step(report, 'Contrôle du total', consistent,
      (consistent
        ? `${diagnostics.computedTotal} € ≈ total DEGIRO`
          + (diagnostics.gapExplique && devises
            ? `, au reliquat de ${diagnostics.totalGap} € près — les soldes en ${devises} que DEGIRO convertit et nous non`
            : '')
        : `écart de ${diagnostics.totalGap} € (nous ${diagnostics.computedTotal} € / DEGIRO ${diagnostics.degiroTotal} €) — ${detail}`
          + (devises ? ` — devises non converties : ${devises}` : '')
          + (pistes ? ` — piste(s) : ${pistes}` : '')
          + (devisesDetail ? ` — par devise : ${devisesDetail}` : ''))
      + fonds);
  }

  if (!payload.positions.length) {
    return { ok: false, report, diagnostics, error: 'Aucune position exploitable trouvée. Le diagnostic ci-dessous indique où ça coince.' };
  }

  const sent = await send(payload);
  step(report, 'Envoi à Analyzer', sent.ok, sent.detail);
  if (!sent.ok) return { ok: false, report, diagnostics, error: sent.detail };

  const summary = {
    at: report.at,
    positions: payload.positions.length,
    total: payload.total_value_eur,
    deduplicated: Boolean(sent.body?.deduplicated),
  };
  await chrome.storage.local.set({ lastCapture: summary });
  return { ok: true, report, diagnostics, summary };
}

/** POST vers l'API Analyzer, avec le jeton d'extension de l'utilisateur. */
async function send(payload) {
  const { apiUrl, token } = await chrome.storage.local.get(['apiUrl', 'token']);
  if (!apiUrl || !token) return { ok: false, detail: "Adresse de l'API ou jeton manquant (voir les réglages ci-dessus)." };

  let res;
  try {
    res = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, detail: `Serveur injoignable : ${String(e.message || e)}` };
  }

  const body = await res.json().catch(() => null);
  if (res.status === 401) return { ok: false, detail: "Jeton refusé (révoqué ou mal collé). Génère-en un nouveau sur la page Import / Extension de l'Analyzer." };
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}${body?.error ? ` — ${body.error}` : ''}` };
  return { ok: true, body, detail: body?.deduplicated ? 'déjà enregistré (identique)' : 'enregistré' };
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type !== 'CAPTURE') return false;
  capture()
    .then(respond)
    .catch((e) => respond({ ok: false, error: String(e.message || e), report: { steps: [], at: new Date().toISOString() } }));
  return true;
});
