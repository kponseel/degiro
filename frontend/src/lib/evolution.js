/**
 * Évolution du patrimoine dans le temps, à partir des captures quotidiennes.
 * Module PUR, testé depuis le backend.
 *
 * Une hausse de la valeur totale ne dit pas si l'on s'est enrichi : un
 * virement de 5 000 € la fait monter d'autant. Les versements nets que DEGIRO
 * fournit (dépôts − retraits depuis l'ouverture) permettent de séparer les
 * deux : variation = versements de la période + effet du marché.
 */

import { monthsBefore } from './priceHistory.js';

export const RANGES = [
  { key: '3m', label: '3 mois', months: 3 },
  { key: '6m', label: '6 mois', months: 6 },
  { key: '1y', label: '1 an', months: 12 },
  { key: 'all', label: 'Tout', months: null },
];

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * @param points  [{ date, total, deposits }] triés (réponse de /api/portfolio/history)
 * @param range   clé de RANGES
 * @returns null si moins de deux points sur la période, sinon :
 *   { points, from, to, change, changePct, deposits, market, marketPct, depositsFrom }
 *   `deposits`/`market` valent null quand les versements ne sont pas connus aux
 *   deux bornes (captures antérieures à la 0.7 de l'extension, imports CSV).
 */
export function evolution(points, range = 'all') {
  const clean = (points || [])
    .map((p) => ({ date: String(p.date), total: num(p.total), deposits: num(p.deposits) }))
    .filter((p) => p.total != null && p.total > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (clean.length < 2) return null;

  const last = clean[clean.length - 1];
  const r = RANGES.find((x) => x.key === range) || RANGES[RANGES.length - 1];
  const from = r.months ? monthsBefore(last.date, r.months) : clean[0].date;
  const inRange = clean.filter((p) => p.date >= from);
  if (inRange.length < 2) return null;

  const first = inRange[0];
  const change = last.total - first.total;

  // Versements : la première et la dernière capture de la période qui les ont.
  const withDep = inRange.filter((p) => p.deposits != null);
  let deposits = null;
  let market = null;
  let marketPct = null;
  let depositsFrom = null;
  if (withDep.length >= 2) {
    const d0 = withDep[0];
    const d1 = withDep[withDep.length - 1];
    deposits = d1.deposits - d0.deposits;
    market = (d1.total - d0.total) - deposits;
    // Méthode de Dietz simple : les versements comptent pour moitié dans la
    // base, faute de savoir à quelle date exacte ils ont eu lieu.
    const base = d0.total + deposits / 2;
    marketPct = base > 0 ? market / base : null;
    depositsFrom = d0.date;
  }

  return {
    points: inRange,
    from: first.date,
    to: last.date,
    change,
    changePct: first.total > 0 ? change / first.total : null,
    deposits,
    market,
    marketPct,
    // Les versements ne sont connus qu'à partir de cette capture : la répartition
    // versements / marché porte sur la période qui commence là.
    depositsFrom,
    hasDeposits: withDep.length > 0,
  };
}
