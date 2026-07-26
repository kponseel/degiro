/**
 * Vue « réalisé / fiscal » — regroupe les plus-values de ventes fermées et les
 * dividendes par période, en CHIFFRES BRUTS (aucun taux d'imposition appliqué).
 *
 * Module PUR (aucune API navigateur) : c'est la partie testable hors navigateur.
 * Une « période » est une année (AAAA) ou un mois (AAAA-MM).
 */

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const yr = (d) => String(d || '').slice(0, 4);
const mo = (d) => String(d || '').slice(0, 7); // AAAA-MM

/** Filtre une liste d'événements datés sur une année (et un mois) optionnels. */
export function filterByPeriod(items, { year = null, month = null } = {}) {
  return (items || []).filter((it) => {
    if (month) return mo(it.date) === month;
    if (year) return yr(it.date) === year;
    return true;
  });
}

/** Totaux bruts d'un lot de ventes réalisées + un lot de dividendes. */
export function periodSummary(events = [], dividends = []) {
  const known = events.filter((e) => e.gain_eur != null);
  const gains = round(known.filter((e) => e.gain_eur > 0).reduce((s, e) => s + e.gain_eur, 0));
  const losses = round(known.filter((e) => e.gain_eur < 0).reduce((s, e) => s + e.gain_eur, 0));
  const net = round(gains + losses);
  const divs = round(dividends.reduce((s, d) => s + (Number(d.amount_eur) || 0), 0));
  return {
    gains,
    losses,
    net,
    dividends: divs,
    total: round(net + divs), // encaissé « réalisé » = plus-values nettes + dividendes
    sales: events.length,
    unknown: events.filter((e) => e.costUnknown).length,
  };
}

/** Récapitulatif année par année (plus récente d'abord). */
export function byYear(events = [], dividends = []) {
  const years = [...new Set([
    ...events.map((e) => yr(e.date)),
    ...dividends.map((d) => yr(d.date)),
  ])].filter(Boolean);
  return years
    .map((y) => ({
      year: y,
      ...periodSummary(
        events.filter((e) => yr(e.date) === y),
        dividends.filter((d) => yr(d.date) === y),
      ),
    }))
    .sort((a, b) => b.year.localeCompare(a.year));
}

/** Mois (AAAA-MM) présents dans une année donnée, triés chronologiquement. */
export function monthsIn(items = [], year) {
  return [...new Set(
    items.filter((it) => yr(it.date) === year).map((it) => mo(it.date)),
  )].filter(Boolean).sort();
}

/** Retour total « vie du portefeuille » : latent + réalisé net + dividendes. */
export function totalReturn({ latentPl = null, realizedNet = 0, dividends = 0 }) {
  const parts = [realizedNet, dividends];
  if (latentPl != null) parts.push(latentPl);
  return {
    latent: latentPl,
    realized: round(realizedNet),
    dividends: round(dividends),
    total: round(parts.reduce((s, v) => s + (Number(v) || 0), 0)),
    partial: latentPl == null, // vrai si le P/L latent manque (retour incomplet)
  };
}
