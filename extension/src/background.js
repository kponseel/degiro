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
import { isComplete, intAccountFromClient, urls } from './session.js';

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
    step(report, 'Script de contenu', false, String(e.message || e));
    return { ok: false, report, error: "L'extension n'a pas pu parler à l'onglet DEGIRO. Recharge la page (F5) puis réessaie." };
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

  // Résolution des identifiants produit en ISIN, par lots de 100.
  const { products } = parsePortfolio(update.json);
  const ids = productIds(products);
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
    captureId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
  });

  step(report, 'Positions retenues', payload.positions.length > 0,
    `${diagnostics.sent} envoyée(s) sur ${diagnostics.held} détenue(s)`
    + (diagnostics.skipped.length ? ` — ignorées faute d'ISIN : ${diagnostics.skipped.map((s) => s.name || s.productId).join(', ')}` : ''));

  // Contrôle de cohérence : notre somme doit coller au total affiché par DEGIRO.
  if (diagnostics.totalGap !== null) {
    const consistent = Math.abs(diagnostics.totalGap) <= 1;
    step(report, 'Contrôle du total', consistent,
      consistent
        ? `${diagnostics.computedTotal} € ≈ total DEGIRO`
        : `écart de ${diagnostics.totalGap} € (nous ${diagnostics.computedTotal} € / DEGIRO ${diagnostics.degiroTotal} €)`);
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
  if (res.status === 401) return { ok: false, detail: 'Jeton refusé (révoqué ou mal collé). Génère-en un nouveau dans Réglages.' };
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
