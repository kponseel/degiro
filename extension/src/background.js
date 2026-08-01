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
import {
  buildPayload, parsePortfolio, parseTransactions, productIds, transactionProductIds, chunk,
} from './degiro.js';
import {
  isComplete, intAccountFromClient, sessionIdFromConfig, urls,
  TX_PATHS_CONNUS, CASH_PATHS_CONNUS,
} from './session.js';
import { captureHistory, makeRangeFetcher, HISTORY_FLOOR } from './history.js';
import {
  captureCash, cashProductIds, cashWindow, cashNextState, cashFloorFromOrders,
} from './cash.js';

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

/**
 * Récupère l'historique des ordres. Toute la stratégie (découverte de la
 * première année, arrêt sur années vides, balayage, mémoire inter-captures)
 * vit dans `history.js`, testable hors navigateur — ici on ne fait que le
 * branchement au stockage et à l'onglet DEGIRO.
 */
async function fetchTransactions(tabId, creds, degiroFetch) {
  // Mémoire par compte DEGIRO ET par jeton Analyzer : régénérer un jeton force
  // une nouvelle découverte complète. C'est le remède documenté quand les
  // données ont été vidées côté Analyzer — l'extension ne peut pas le détecter.
  const { token, txPath: memorise } = await chrome.storage.local.get(['token', 'txPath']);
  const cle = `txHistory_${creds.intAccount}_${String(token || '').slice(0, 12)}`;
  const state = (await chrome.storage.local.get(cle))[cle] || null;

  // Chemins candidats vers l'historique, par ordre de confiance : celui que
  // l'application DEGIRO utilise ELLE-MÊME (relevé par inject.js quand
  // l'utilisateur visite sa page Transactions), celui qui a marché la dernière
  // fois, puis les versions connues. Motif : le 29/07/2026, v4 s'est mis à
  // répondre 502 en continu — l'endpoint avait bougé.
  const candidates = [...new Set(
    [creds.txPath, memorise, ...TX_PATHS_CONNUS].filter(Boolean),
  )];

  let cheminRetenu = false;
  const doFetch = async (path, du, au, grouper) => {
    const res = await degiroFetch(
      (sid) => urls.transactions(creds.intAccount, sid, du, au, grouper, path),
    );
    if (res?.ok && res.json) {
      // Premier succès de la capture : ce chemin est le bon, on s'en souvient
      // pour les captures futures (même sans page Transactions ouverte).
      if (!cheminRetenu) {
        cheminRetenu = true;
        if (path !== memorise) chrome.storage.local.set({ txPath: path }).catch(() => {});
      }
      return { ok: true, rows: parseTransactions(res.json) };
    }
    const corps = String(res?.text || res?.error || '').trim().slice(0, 120);
    return { ok: false, status: res?.status, reason: `HTTP ${res?.status ?? '?'}${corps ? ` — ${corps}` : ''}` };
  };
  const fetchRange = makeRangeFetcher({ candidates, doFetch });

  const out = await captureHistory({ today: new Date(), state, fetchRange });
  // La mémoire n'est PAS écrite ici : tant que l'envoi à Analyzer n'a pas
  // abouti, ces ordres ne sont enregistrés nulle part. L'écrire trop tôt — un
  // jeton manquant suffit — condamnerait l'historique à ne jamais repartir,
  // chaque capture suivante ne relisant plus que la période récente.
  //
  // `decouverte` dit si cette lecture a balayé TOUT l'historique ou seulement la
  // période récente. Sans cette distinction, le plancher du relevé se déduirait
  // d'une poignée d'ordres du mois dernier et raterait des années de versements.
  return { ...out, storageKey: cle, decouverte: !state };
}

/**
 * Récupère le RELEVÉ DE COMPTE (dépôts, retraits, dividendes, taxes, frais) —
 * ce qu'il fallait exporter à la main dans un `Account.csv` pour débloquer la
 * performance réelle (TWR) et les dividendes.
 *
 * Même architecture que l'historique des ordres : stratégie pure dans `cash.js`,
 * mémoire par compte et par jeton, chemin d'endpoint suivi puis mémorisé.
 *
 * @param debutConnu 'AAAA-MM-JJ' découvert par l'historique, ou null : évite de
 *                   balayer des années où le compte n'existait pas.
 */
async function fetchCashMovements(tabId, creds, degiroFetch, debutConnu) {
  const { token, cashPath: memorise } = await chrome.storage.local.get(['token', 'cashPath']);
  const cle = `cashHistory_${creds.intAccount}_${String(token || '').slice(0, 12)}`;
  const state = (await chrome.storage.local.get(cle))[cle] || null;

  const candidates = [...new Set(
    [creds.cashPath, memorise, ...CASH_PATHS_CONNUS].filter(Boolean),
  )];

  let cheminRetenu = false;
  const doFetch = async (path, du, au) => {
    const res = await degiroFetch(
      (sid) => urls.accountOverview(creds.intAccount, sid, du, au, path),
    );
    // Une enveloppe JSON bien formée vaut succès, MÊME sans liste de mouvements :
    // une période sans le moindre mouvement — les premières années d'un compte —
    // ne renvoie pas de `cashMovements`. La compter comme un refus empêchait à
    // jamais la mémoire de couverture de se poser, et faisait relire tout le
    // relevé à chaque capture (constaté : « 2 période(s) refusée(s) — HTTP 200 »).
    const json = res?.ok && res.json && typeof res.json === 'object' && !Array.isArray(res.json)
      ? res.json : null;
    if (json) {
      const enveloppe = json.data && typeof json.data === 'object' ? json.data : json;
      const mouvements = enveloppe.cashMovements;
      if (!cheminRetenu) {
        cheminRetenu = true;
        if (path !== memorise) chrome.storage.local.set({ cashPath: path }).catch(() => {});
      }
      return { ok: true, rows: Array.isArray(mouvements) ? mouvements : [] };
    }
    const corps = String(res?.text || res?.error || '').trim().slice(0, 120);
    return { ok: false, status: res?.status, reason: `HTTP ${res?.status ?? '?'}${corps ? ` — ${corps}` : ''}` };
  };
  const fetchRange = makeRangeFetcher({ candidates, doFetch });

  const today = new Date();
  const { from, to, since } = cashWindow({
    today, state, floorSince: debutConnu, floorYear: HISTORY_FLOOR,
  });
  const out = await captureCash({ from, to, fetchRange });
  return {
    ...out,
    storageKey: cle,
    nextState: cashNextState({ complete: out.complete, since, to }),
    depuis: since,
  };
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

  // Historique complet des ordres — positions fermées et plus-values réalisées.
  // Best-effort : un échec ici n'empêche pas la capture du portefeuille.
  const tx = await fetchTransactions(tab.id, creds, degiroFetch);
  const txJson = tx.rows.length ? tx.rows : null;
  step(report, 'Historique des transactions', tx.rows.length > 0 || tx.failed === 0, tx.detail);

  // Relevé de compte : dépôts (donc TWR), dividendes, taxes et frais. Best-effort
  // lui aussi — et l'import manuel d'un Account.csv reste possible en secours.
  // Plancher de lecture du relevé. Le resserrement sur le premier ordre n'est
  // légitime QUE si l'historique vient d'être balayé en entier : sur une lecture
  // incrémentale, les ordres connus se limitent au mois écoulé et le plancher
  // qu'ils suggèrent raterait des années de versements — définitivement, puisque
  // la mémoire du relevé serait ensuite posée sur ce début tronqué.
  const debutHistorique = tx.nextState?.completeSince ?? null;
  const cash = await fetchCashMovements(
    tab.id, creds, degiroFetch,
    tx.decouverte ? cashFloorFromOrders(tx.rows, debutHistorique) : debutHistorique,
  );
  step(report, 'Relevé de compte', cash.rows.length > 0 || cash.failed === 0, cash.detail);

  // Résolution des identifiants produit en ISIN, par lots de 100. On résout à la
  // fois les positions (détenues + soldées), les produits cités par les ordres et
  // ceux cités par le relevé : une position fermée n'apparaît plus dans le
  // portefeuille courant, et un dividende sans ISIN n'est rattachable à rien.
  const { products, closed } = parsePortfolio(update.json);
  const ids = [...new Set([
    ...productIds(products),
    ...productIds(closed),
    ...transactionProductIds(parseTransactions(txJson)),
    ...cashProductIds(cash.rows),
  ])];
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
    transactions: txJson,
    cashMovements: cash.rows,
    captureId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
  });

  step(report, 'Positions retenues', payload.positions.length > 0,
    `${diagnostics.sent - diagnostics.closed} envoyée(s) sur ${diagnostics.held} détenue(s)`
    + (diagnostics.closed ? ` + ${diagnostics.closed} fermée(s)` : '')
    + (diagnostics.skipped.length ? ` — ignorées faute d'ISIN : ${diagnostics.skipped.map((s) => s.name || s.productId).join(', ')}` : ''));

  if (diagnostics.transactionsRead > 0) {
    const ordres = diagnostics.transactions - (diagnostics.cashMovements || 0);
    step(report, 'Transactions retenues', ordres > 0,
      `${ordres} ordre(s) envoyé(s) sur ${diagnostics.transactionsRead} lu(s)`
      + (diagnostics.cashMovements ? `, + ${diagnostics.cashMovements} mouvement(s) du relevé` : ''));
  }

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
    const detail = `titres ${diagnostics.positionsTotal} € (DEGIRO ${diagnostics.degiroPositions ?? '?'} €)`
      + `, ${diagnostics.valued}/${diagnostics.held} position(s) valorisée(s)`
      + `, liquidités ${diagnostics.cash ?? '?'} € (source : ${diagnostics.cashSource})`;
    // Les lignes suspectes sont nommées : un écart qui désigne son origine se
    // vérifie en dix secondes sur le site DEGIRO, un écart nu jamais.
    const pistes = (diagnostics.suspects || []).slice(0, 3).join(' ; ');
    // Ventilation par devise : sur une devise étrangère, « valeur » et
    // « cours × quantité » doivent différer du taux de change. S'ils sont égaux,
    // la valeur reçue est locale et comptée à tort comme des euros.
    const devisesDetail = (diagnostics.parDevise || [])
      .map((d) => `${d.devise} ${d.lignes} ligne(s) ${d.valeur} €`
        + (d.local === null ? '' : ` (cours×qté ${d.local})`))
      .join(' ; ');
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

  // L'envoi a abouti ET chaque ordre lu figure dans le payload : la mémoire de
  // couverture peut être posée. Si des ordres ont été écartés faute d'ISIN
  // résolu (panne passagère de products/info), on ne la pose PAS — la capture
  // suivante relira tout, ce qui coûte quelques requêtes mais ne perd rien.
  // Le payload porte désormais AUSSI les mouvements du relevé : la comparaison
  // doit se faire sur les seuls ordres, sans quoi la mémoire ne serait plus
  // jamais posée.
  const ordresEnvoyes = diagnostics.transactions - (diagnostics.cashMovements || 0);
  const historiqueEntier = diagnostics.transactionsRead === ordresEnvoyes;
  if (tx.nextState && tx.storageKey && historiqueEntier) {
    await chrome.storage.local.set({ [tx.storageKey]: tx.nextState }).catch(() => {});
  }
  // Mémoire du relevé, indépendante : elle n'est posée que si toutes ses
  // périodes ont répondu (`cash.complete`), sinon la capture suivante reprend
  // depuis le même début et rattrape le trou.
  if (cash.nextState && cash.storageKey) {
    await chrome.storage.local.set({ [cash.storageKey]: cash.nextState }).catch(() => {});
  }

  const summary = {
    at: report.at,
    positions: payload.positions.length,
    transactions: ordresEnvoyes,
    movements: diagnostics.cashMovements || 0,
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
