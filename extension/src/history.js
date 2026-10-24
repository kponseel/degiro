/**
 * Historique des cours et des taux de change — logique pure, testée depuis le
 * backend (backend/test/extensionHistory.test.js).
 *
 * Cours : le service de graphiques que l'application DEGIRO utilise elle-même
 * (vwd, `charting.vwdservices.com`). Il donne l'historique du produit exact
 * détenu, sur sa place de cotation et dans sa devise — pas une cotation voisine
 * devinée à partir de l'ISIN. Format non documenté : le lecteur ci-dessous est
 * volontairement tolérant, et le diagnostic dit ce qui a été reçu.
 *
 * Change : taux de référence quotidiens de la BCE, via Frankfurter (gratuit,
 * sans clé). Les cours en devise sont convertis en euros AU TAUX DE CHAQUE
 * JOUR : une action américaine stable peut avoir perdu 10 % en euros si le
 * dollar a baissé.
 *
 * Le serveur de l'Analyzer ne peut pas appeler l'extérieur (filtré chez
 * l'hébergeur) : c'est donc l'extension qui va chercher ces données.
 */

export const CHART_BASE = 'https://charting.vwdservices.com/hchart/v1/deGiro/data.js';
export const FX_BASES = ['https://api.frankfurter.dev/v1', 'https://api.frankfurter.app'];

/** Deux profondeurs : 1 an au jour près (repères 3/6/12 mois), 5 ans à la semaine (plus haut long terme). */
export const SPANS = {
  daily: { period: 'P1Y', resolution: 'P1D' },
  weekly: { period: 'P5Y', resolution: 'P1W' },
};

/** Identifiant vwd d'un produit (`products/info`) : `{ id, type }` ou null. */
export function vwdIdOf(info) {
  const id = info?.vwdId ?? info?.vwdIdSecondary;
  if (id === undefined || id === null || String(id).trim() === '') return null;
  const rawType = info?.vwdId != null ? info?.vwdIdentifierType : info?.vwdIdentifierTypeSecondary;
  const type = String(rawType || 'issueid').toLowerCase() === 'vwdkey' ? 'vwdkey' : 'issueid';
  return { id: String(id).trim(), type };
}

/** URL du graphique vwd pour un produit, une période et une résolution. */
export function chartUrl({ vwd, userToken, period, resolution }) {
  const q = new URLSearchParams({
    requestid: '1',
    resolution,
    culture: 'fr-FR',
    period,
    series: `price:${vwd.type}:${vwd.id}`,
    format: 'json',
    callback: '',
    userToken: String(userToken ?? ''),
    tz: 'Europe/Paris',
  });
  return `${CHART_BASE}?${q}`;
}

/** Durée ISO 8601 simple (P1D, P7D, P1W, PT1H, PT15M) → millisecondes ; null sinon. */
export function durationMs(iso) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso || '').trim());
  if (!m || m.slice(1).every((x) => x === undefined)) return null;
  const [, w, d, h, mi, s] = m.map((x) => Number(x || 0));
  return ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Début d'une plage `times` (« 2025-10-24T00:00:00/P1D ») ; sans fuseau, lu en UTC. */
function parseStart(s) {
  const txt = String(s || '').trim();
  if (!txt) return null;
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(txt) ? txt : `${txt}Z`;
  const t = Date.parse(withZone);
  return Number.isFinite(t) ? t : null;
}

/** Retire un éventuel habillage JSONP (`callback({...});`) et parse. */
export function parseJsonLoose(body) {
  if (body && typeof body === 'object') return body;
  const txt = String(body || '').trim();
  if (!txt) return null;
  const unwrapped = txt.replace(/^[\w.$]*\(\s*/, '').replace(/\)\s*;?\s*$/, '');
  for (const candidate of [txt, unwrapped]) {
    try { return JSON.parse(candidate); } catch { /* suivant */ }
  }
  return null;
}

/**
 * Réponse vwd → `[[AAAA-MM-JJ, clôture], …]`, triée, un point par jour.
 *
 * Les points arrivent en `[x, y]` où `x` est, selon les cas observés dans les
 * clients de la communauté, un rang dans la résolution depuis le début de la
 * plage (`times`), ou un horodatage. Les deux sont acceptés. Une série OHLC
 * (`[x, o, h, l, c]`) donne sa clôture, la dernière valeur.
 */
export function parseChart(body) {
  const json = parseJsonLoose(body);
  const series = Array.isArray(json?.series) ? json.series : [];
  const s = series.find((x) => /^price:/i.test(String(x?.id || '')) && Array.isArray(x?.data))
    || series.find((x) => x?.type === 'time' && Array.isArray(x?.data));
  if (!s) return [];

  const [startTxt, stepTxt] = String(s.times || '').split('/');
  const start = parseStart(startTxt) ?? parseStart(json?.start);
  const step = durationMs(stepTxt) ?? durationMs(json?.resolution);

  const byDay = new Map();
  for (const p of s.data) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]);
    const y = Number(p[p.length - 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || y <= 0) continue;
    let t;
    if (x > 1e11) t = x; // millisecondes
    else if (x > 1e9) t = x * 1000; // secondes
    else if (start != null && step != null) t = start + x * step; // rang
    else continue;
    byDay.set(isoDay(t), Math.round(y * 1e6) / 1e6);
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** Devise de cotation → devise BCE et diviseur (les pence londoniens valent 1/100 de livre). */
export function fxCurrencyOf(currency) {
  const c = String(currency || '').trim();
  if (c === 'GBX' || c === 'GBp') return { code: 'GBP', divisor: 100 };
  return { code: c.toUpperCase(), divisor: 1 };
}

/** URL Frankfurter : taux BCE quotidiens, base EUR, pour les devises demandées. */
export function fxUrl(base, codes, from, to) {
  return `${base}/${from}..${to}?base=EUR&symbols=${codes.map(encodeURIComponent).join(',')}`;
}

/** Réponse Frankfurter → `{ USD: [[AAAA-MM-JJ, unités pour 1 €], …], … }`. */
export function parseFx(body) {
  const json = parseJsonLoose(body);
  const out = {};
  for (const [day, rates] of Object.entries(json?.rates || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !rates || typeof rates !== 'object') continue;
    for (const [code, r] of Object.entries(rates)) {
      const v = Number(r);
      if (!/^[A-Z]{3}$/.test(code) || !Number.isFinite(v) || v <= 0) continue;
      (out[code] ||= []).push([day, v]);
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

/** Exécute `tasks` (fonctions asynchrones) avec au plus `limit` en parallèle, dans l'ordre. */
export async function pool(tasks, limit = 4) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next;
      next += 1;
      results[i] = await tasks[i]().catch((e) => ({ error: String(e?.message || e) }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
