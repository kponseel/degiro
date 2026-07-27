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

/**
 * Motifs pour lesquels une vente n'a pas de plus-value calculable, et ce que
 * l'utilisateur peut y faire. Les confondre revenait à afficher un tableau de
 * tirets muet, ou pire, à imputer systématiquement la cause à un historique
 * trop court alors que le fichier importé était en cause.
 */
export const UNKNOWN_REASONS = {
  no_history: {
    court: 'achat hors historique',
    long: "le titre a été acheté avant la période couverte par ton Transactions.csv — son prix de revient est inconnu",
    remede: 'Réexporte un Transactions.csv qui remonte plus loin.',
  },
  incomplete_cost: {
    court: 'achat sans montant en euros',
    long: "un achat de cette ligne n'avait pas de montant en euros exploitable, ce qui rend le prix moyen indéterminé tant que la position reste ouverte",
    remede: "Vérifie que ton export contient bien une colonne de valeur en EUR (« Valeur » ou « Total »).",
  },
  amount_missing: {
    court: 'vente sans montant en euros',
    long: "cette vente n'avait pas de montant en euros exploitable",
    remede: "Vérifie que ton export contient bien une colonne de valeur en EUR (« Valeur » ou « Total »).",
  },
};

/** Compte les occurrences de chaque valeur → { valeur: n }. */
const countBy = (values) => values.reduce((acc, v) => (v ? { ...acc, [v]: (acc[v] || 0) + 1 } : acc), {});

/** Totaux bruts d'un lot de ventes réalisées + un lot de dividendes. */
export function periodSummary(events = [], dividends = []) {
  const known = events.filter((e) => e.gain_eur != null);
  const gains = round(known.filter((e) => e.gain_eur > 0).reduce((s, e) => s + e.gain_eur, 0));
  const losses = round(known.filter((e) => e.gain_eur < 0).reduce((s, e) => s + e.gain_eur, 0));
  const net = round(gains + losses);
  const divs = round(dividends.reduce((s, d) => s + (Number(d.amount_eur) || 0), 0));
  const inconnues = events.filter((e) => e.costUnknown);
  return {
    gains,
    losses,
    net,
    dividends: divs,
    total: round(net + divs), // encaissé « réalisé » = plus-values nettes + dividendes
    sales: events.length,
    computed: known.length,
    unknown: inconnues.length,
    unknownBy: countBy(inconnues.map((e) => e.unknownReason)),
  };
}

/**
 * Phrase expliquant les ventes non calculées d'une période, motif par motif.
 * Retourne null quand tout est calculé — il n'y a alors rien à dire.
 */
export function explainUnknown(unknownBy = {}) {
  const parts = Object.entries(unknownBy)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!parts.length) return null;
  return parts.map(([motif, n]) => {
    const r = UNKNOWN_REASONS[motif];
    const libelle = r ? r.long : 'cause inconnue';
    return { motif, n, texte: `${n} ${n > 1 ? 'ventes' : 'vente'} : ${libelle}`, remede: r?.remede || null };
  });
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
