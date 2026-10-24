/**
 * Historique des cours d'une ligne : conversion en euros au taux de CHAQUE
 * jour, puis repères — plus haut, moyenne et plus bas sur 3, 6 et 12 mois, plus
 * haut sur 5 ans, et prix de revient. Module PUR, testé depuis le backend.
 *
 * L'idée : une action à −70 % ne reviendra peut-être jamais à son sommet, mais
 * son plus haut ou sa moyenne des derniers mois sont des niveaux qu'elle a
 * réellement tenus récemment. Chaque repère est donné avec la variation qu'il
 * faudrait depuis le cours actuel pour l'atteindre.
 */

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Devise de cotation → devise BCE et diviseur (pence londoniens). */
export function fxCurrencyOf(currency) {
  const c = String(currency || '').trim();
  if (c === 'GBX' || c === 'GBp') return { code: 'GBP', divisor: 100 };
  return { code: c.toUpperCase(), divisor: 1 };
}

/** Dernier taux connu à la date `day` (ou le premier si la date le précède). */
function rateAt(rates, day) {
  let lo = 0;
  let hi = rates.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rates[mid][0] <= day) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return rates[best >= 0 ? best : 0][1];
}

/**
 * Points `[jour, cours en devise]` → `[jour, cours en €]`.
 * @returns {{ points: Array<[string, number]>, unit: string }} `unit` vaut
 *   'EUR', ou la devise d'origine si aucun taux n'est disponible (jamais de
 *   conversion inventée).
 */
export function toEur(points, currency, fx) {
  const clean = (points || []).filter((p) => Array.isArray(p) && num(p[1]) > 0).map((p) => [String(p[0]), Number(p[1])]);
  const { code, divisor } = fxCurrencyOf(currency || 'EUR');
  if (code === 'EUR' || !code) return { points: clean.map(([d, v]) => [d, v / divisor]), unit: 'EUR' };
  const rates = (fx?.[code] || []).filter((r) => num(r[1]) > 0);
  if (!rates.length) return { points: clean.map(([d, v]) => [d, v / divisor]), unit: code };
  return { points: clean.map(([d, v]) => [d, v / divisor / rateAt(rates, d)]), unit: 'EUR' };
}

/** « AAAA-MM-JJ » reculé de `months` mois (fin de mois bornée : 31/05 − 3 mois → 28/02). */
export function monthsBefore(day, months) {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Plus haut, plus bas et moyenne des clôtures depuis `from` inclus. */
export function windowStats(points, from) {
  const inWin = points.filter(([d]) => d >= from);
  if (!inWin.length) return null;
  let high = inWin[0];
  let low = inWin[0];
  let sum = 0;
  for (const p of inWin) {
    if (p[1] > high[1]) high = p;
    if (p[1] < low[1]) low = p;
    sum += p[1];
  }
  return { high: high[1], highDate: high[0], low: low[1], lowDate: low[0], avg: sum / inWin.length, n: inWin.length };
}

/** Variation à parcourir pour aller du cours actuel au niveau `level` (+47 % = il faut monter de 47 %). */
const toLevel = (now, level) => (now > 0 && level > 0 ? level / now - 1 : null);

export const WINDOWS = [
  { key: 'm3', label: '3 mois', months: 3 },
  { key: 'm6', label: '6 mois', months: 6 },
  { key: 'm12', label: '12 mois', months: 12 },
];

/**
 * Repères d'une ligne.
 *
 * @param history  { currency, daily, weekly } tel que renvoyé par /api/prices
 * @param fx       { USD: [[jour, unités pour 1 €], …], … }
 * @param position { value_eur, qty, pl_eur } de la dernière capture : son cours
 *                 en euros (valeur / quantité) est le « cours actuel », le même
 *                 que partout ailleurs dans l'application ; `pl_eur` donne le
 *                 prix de revient.
 * @returns null sans historique, sinon les repères (voir les tests)
 */
export function historyStats(history, fx, position = {}) {
  if (!history) return null;
  const daily = toEur(history.daily, history.currency, fx);
  const weekly = toEur(history.weekly, history.currency, fx);
  if (!daily.points.length && !weekly.points.length) return null;
  const unit = daily.points.length ? daily.unit : weekly.unit;

  // Le long terme mélange l'hebdomadaire sur 5 ans et le quotidien récent, plus fin.
  const firstDaily = daily.points[0]?.[0];
  const long = [...weekly.points.filter(([d]) => !firstDaily || d < firstDaily), ...daily.points];
  const series = daily.points.length ? daily.points : long;
  const lastDay = series[series.length - 1][0];

  // Cours actuel = dernier point de l'historique, relevé à la capture : les
  // repères sont calculés sur la même série, donc cohérents entre eux. (La
  // valeur de ligne DEGIRO / quantité, convertie à un autre taux, pouvait
  // placer le cours sous son propre plus bas.)
  const qty = num(position.qty);
  const value = num(position.value_eur);
  const now = series[series.length - 1][1];

  const windows = {};
  for (const w of WINDOWS) {
    const s = windowStats(series, monthsBefore(lastDay, w.months));
    windows[w.key] = s && {
      ...s,
      toHigh: toLevel(now, s.high),
      toAvg: toLevel(now, s.avg),
      toLow: toLevel(now, s.low),
      fromHigh: s.high > 0 ? now / s.high - 1 : null,
    };
  }
  const y5 = windowStats(long, monthsBefore(lastDay, 60));
  if (y5) {
    windows.y5 = { ...y5, toHigh: toLevel(now, y5.high), toAvg: toLevel(now, y5.avg), toLow: toLevel(now, y5.low), fromHigh: now / y5.high - 1 };
  }

  // Prix de revient par titre (en €) : coût des titres détenus / quantité.
  const pl = num(position.pl_eur);
  const pru = unit === 'EUR' && qty > 0 && value != null && pl != null && value - pl > 0 ? (value - pl) / qty : null;
  let pruInfo = null;
  if (pru) {
    const above = [...long].reverse().find(([, v]) => v >= pru);
    pruInfo = {
      level: pru,
      toLevel: toLevel(now, pru),
      lastAbove: above ? above[0] : null,
      // Le PRU a-t-il été dépassé à un moment de la période couverte ?
      reachedInSpan: Boolean(above),
      spanFrom: long[0][0],
    };
  }

  return {
    unit,
    now,
    lastDay,
    series,
    long,
    windows,
    pru: pruInfo,
    converted: unit === 'EUR' && fxCurrencyOf(history.currency).code !== 'EUR',
    currency: history.currency || null,
  };
}

/** Index ISIN → historique, depuis la réponse de /api/prices. */
export function indexHistory(prices) {
  const map = new Map();
  for (const s of prices?.series || []) map.set(s.isin, s);
  return map;
}
