import { daysBetween } from './format.js';

/**
 * « Depuis ta dernière capture » : ce qui a changé entre deux snapshots de la
 * MÊME source. Module PUR, testé depuis le backend.
 *
 * Trois natures de changement, séparées parce qu'elles ne disent pas la même
 * chose :
 *  - le marché : variation de valeur à quantité CONSTANTE (quantité d'avant ×
 *    écart de valeur unitaire), sur les lignes présentes aux deux dates ;
 *  - tes décisions : lignes nouvelles, soldées, quantités modifiées ;
 *  - le reste (versements, dividendes, frais) n'est pas isolable ici : le total
 *    bouge aussi pour ces raisons, et la carte ne prétend pas le découper.
 */

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const unit = (p) => {
  const q = num(p.qty);
  const v = num(p.value_eur);
  return q && v != null ? v / q : null;
};

const THRESHOLDS = [0.1, 0.15];

/**
 * @param latest    { snapshot, positions }
 * @param previous  { snapshot, positions } | null
 * @returns null si pas de point de comparaison, sinon le détail du changement
 */
export function diffSnapshots(latest, previous) {
  if (!latest?.snapshot || !previous?.snapshot) return null;
  if (latest.snapshot.source !== previous.snapshot.source) return null;

  const now = new Map((latest.positions || []).map((p) => [p.isin, p]));
  const before = new Map((previous.positions || []).map((p) => [p.isin, p]));
  const investedNow = [...now.values()].reduce((s, p) => s + (num(p.value_eur) || 0), 0);
  const investedBefore = [...before.values()].reduce((s, p) => s + (num(p.value_eur) || 0), 0);

  const added = [];
  const closed = [];
  const resized = [];
  const moves = [];
  const crossings = [];

  for (const [isin, p] of now) {
    const q = before.get(isin);
    if (!q) { added.push({ isin, name: p.name || isin, value: num(p.value_eur) || 0 }); continue; }
    const qNow = num(p.qty);
    const qBefore = num(q.qty);
    if (qNow != null && qBefore != null && qNow !== qBefore) {
      const u = unit(p);
      resized.push({ isin, name: p.name || isin, from: qBefore, to: qNow, approx: u == null ? null : (qNow - qBefore) * u });
    }
    const uNow = unit(p);
    const uBefore = unit(q);
    if (uNow != null && uBefore != null && qBefore) {
      moves.push({ isin, name: p.name || isin, move: qBefore * (uNow - uBefore), pct: uBefore > 0 ? uNow / uBefore - 1 : null });
    }
    const wNow = investedNow > 0 ? (num(p.value_eur) || 0) / investedNow : 0;
    const wBefore = investedBefore > 0 ? (num(q.value_eur) || 0) / investedBefore : 0;
    for (const t of THRESHOLDS) {
      if (wBefore < t && wNow >= t) crossings.push({ isin, name: p.name || isin, threshold: t, up: true, weight: wNow });
      if (wBefore >= t && wNow < t) crossings.push({ isin, name: p.name || isin, threshold: t, up: false, weight: wNow });
    }
  }
  for (const [isin, q] of before) {
    if (!now.has(isin)) closed.push({ isin, name: q.name || isin, value: num(q.value_eur) || 0 });
  }

  const totalNow = num(latest.snapshot.total_value_eur);
  const totalBefore = num(previous.snapshot.total_value_eur);
  const cashNow = num(latest.snapshot.cash_eur);
  const cashBefore = num(previous.snapshot.cash_eur);
  const totalDelta = totalNow != null && totalBefore != null ? totalNow - totalBefore : null;
  const byMove = [...moves].sort((a, b) => b.move - a.move);

  return {
    since: previous.snapshot.snapshot_date,
    days: daysBetween(previous.snapshot.snapshot_date, latest.snapshot.snapshot_date),
    totalDelta,
    totalPct: totalDelta != null && totalBefore > 0 ? totalDelta / totalBefore : null,
    cashDelta: cashNow != null && cashBefore != null ? cashNow - cashBefore : null,
    market: moves.length ? moves.reduce((s, m) => s + m.move, 0) : null,
    up: byMove.filter((m) => m.move > 0.005).slice(0, 4),
    down: byMove.filter((m) => m.move < -0.005).reverse().slice(0, 4),
    added,
    closed,
    resized,
    crossings,
  };
}
