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
import { isComplete, intAccountFromClient, urls, TX_PATHS_CONNUS } from './session.js';
import { captureHistory, makeRangeFetcher } from './history.js';

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

/**
 * Récupère l'historique des ordres. Toute la stratégie (découverte de la
 * première année, arrêt sur années vides, balayage, mémoire inter-captures)
 * vit dans `history.js`, testable hors navigateur — ici on ne fait que le
 * branchement au stockage et à l'onglet DEGIRO.
 */
async function fetchTransactions(tabId, creds) {
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
    const res = await ask(tabId, {
      type: 'FETCH',
      url: urls.transactions(creds.intAccount, creds.sessionId, du, au, grouper, path),
    }).catch((e) => ({ ok: false, status: 0, error: String(e.message || e) }));
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
  return { ...out, storageKey: cle };
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

  // Secours : si l'application n'a encore rien appelé, on interroge /pa/secure/client,
  // qui répond aussi à la seule force du cookie de session.
  if (creds.sessionId && !creds.intAccount) {
    const client = await ask(tab.id, { type: 'FETCH', url: urls.client(creds.sessionId) });
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

  const update = await ask(tab.id, { type: 'FETCH', url: urls.update(creds.intAccount, creds.sessionId) });
  if (!step(report, 'Lecture du portefeuille', Boolean(update?.ok && update.json),
    update?.ok ? 'reçu' : `HTTP ${update?.status ?? '?'}${update?.error ? ` — ${update.error}` : ''}`)) {
    return { ok: false, report, error: update?.status === 401 ? 'Session DEGIRO expirée : reconnecte-toi puis réessaie.' : 'DEGIRO a refusé la lecture du portefeuille.' };
  }

  // Historique complet des ordres — positions fermées et plus-values réalisées.
  // Best-effort : un échec ici n'empêche pas la capture du portefeuille.
  const tx = await fetchTransactions(tab.id, creds);
  const txJson = tx.rows.length ? tx.rows : null;
  step(report, 'Historique des transactions', tx.rows.length > 0 || tx.failed === 0, tx.detail);

  // Résolution des identifiants produit en ISIN, par lots de 100. On résout à la
  // fois les positions (détenues + soldées) et les produits cités par les ordres :
  // une position fermée n'apparaît plus dans le portefeuille courant.
  const { products, closed } = parsePortfolio(update.json);
  const ids = [...new Set([
    ...productIds(products),
    ...productIds(closed),
    ...transactionProductIds(parseTransactions(txJson)),
  ])];
  const lots = [];
  for (const batch of chunk(ids, 100)) {
    const res = await ask(tab.id, {
      type: 'FETCH',
      url: urls.productsInfo(creds.intAccount, creds.sessionId),
      method: 'POST',
      body: batch,
    });
    if (res?.ok && res.json) lots.push(res.json);
  }
  const resolved = lots.reduce((n, l) => n + Object.keys(l?.data || {}).length, 0);
  step(report, 'Résolution des ISIN', resolved > 0 || ids.length === 0, `${resolved}/${ids.length} produit(s)`);

  const { payload, diagnostics } = buildPayload({
    update: update.json,
    products: lots,
    transactions: txJson,
    captureId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
  });

  step(report, 'Positions retenues', payload.positions.length > 0,
    `${diagnostics.sent - diagnostics.closed} envoyée(s) sur ${diagnostics.held} détenue(s)`
    + (diagnostics.closed ? ` + ${diagnostics.closed} fermée(s)` : '')
    + (diagnostics.skipped.length ? ` — ignorées faute d'ISIN : ${diagnostics.skipped.map((s) => s.name || s.productId).join(', ')}` : ''));

  if (diagnostics.transactionsRead > 0) {
    step(report, 'Transactions retenues', diagnostics.transactions > 0,
      `${diagnostics.transactions} envoyée(s) sur ${diagnostics.transactionsRead} lue(s)`);
  }

  // Contrôle de cohérence : notre somme doit coller au total affiché par DEGIRO.
  if (diagnostics.totalGap !== null) {
    const consistent = Math.abs(diagnostics.totalGap) <= 1;
    // Les devises non converties sont la cause la plus fréquente d'un reliquat :
    // le dire évite de faire chercher une lecture fautive là où il n'y en a pas.
    const devises = (diagnostics.cashOther || [])
      .map((c) => `${c.value} ${c.currency}`).join(', ');
    // Décomposition titres / liquidités des deux côtés : un écart nu ne dit pas
    // s'il vient d'une position mal lue ou d'un solde mal compté.
    const detail = `titres ${diagnostics.positionsTotal} € (DEGIRO ${diagnostics.degiroPositions ?? '?'} €)`
      + `, liquidités ${diagnostics.cash ?? '?'} € (DEGIRO ${diagnostics.degiroCash ?? '?'} €, source : ${diagnostics.cashSource})`;
    // Les lignes suspectes sont nommées : un écart qui désigne son origine se
    // vérifie en dix secondes sur le site DEGIRO, un écart nu jamais.
    const pistes = (diagnostics.suspects || []).slice(0, 3).join(' ; ');
    step(report, 'Contrôle du total', consistent,
      consistent
        ? `${diagnostics.computedTotal} € ≈ total DEGIRO`
        : `écart de ${diagnostics.totalGap} € (nous ${diagnostics.computedTotal} € / DEGIRO ${diagnostics.degiroTotal} €) — ${detail}`
          + (devises ? ` — devises non converties : ${devises}` : '')
          + (pistes ? ` — piste(s) : ${pistes}` : ''));
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
  const historiqueEntier = diagnostics.transactionsRead === payload.transactions.length;
  if (tx.nextState && tx.storageKey && historiqueEntier) {
    await chrome.storage.local.set({ [tx.storageKey]: tx.nextState }).catch(() => {});
  }

  const summary = {
    at: report.at,
    positions: payload.positions.length,
    transactions: payload.transactions.length,
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
