/**
 * Garde-fou contre une capture incomplète.
 *
 * Une réponse DEGIRO tronquée (page pas encore chargée, mise à jour partielle)
 * donnait une capture « valide » de 7 lignes au lieu de 22, avec des liquidités
 * fausses — et, un seul snapshot étant gardé par jour et par source, elle
 * REMPLAÇAIT silencieusement la bonne capture du jour. La carte « Depuis ta
 * capture » annonçait alors −89 % et 15 lignes soldées.
 *
 * Est jugée suspecte une capture qui, par rapport à la précédente récente, a à
 * la fois perdu au moins la moitié de ses lignes ET la moitié de sa valeur
 * totale. Vendre la moitié de ses lignes laisse le total (liquidités comprises)
 * à peu près intact ; perdre la moitié de sa valeur sans rien vendre est un
 * krach : les deux ensemble, en quelques jours, sont bien plus probablement une
 * lecture ratée. L'utilisateur peut toujours forcer l'envoi.
 *
 * Même règle côté client : frontend/src/lib/snapshotDiff.js (SUSPECT_*).
 */
export const SUSPECT_MIN_LINES = 4;
export const SUSPECT_RATIO = 0.5;
export const SUSPECT_WINDOW_DAYS = 14;

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param now     { lines, total }
 * @param before  { lines, total }
 * @returns true si la capture `now` ressemble à une lecture incomplète
 */
export function isSuspectDrop(now, before) {
  const lb = num(before?.lines);
  const tb = num(before?.total);
  const ln = num(now?.lines);
  const tn = num(now?.total);
  if (lb == null || tb == null || ln == null || tn == null) return false;
  if (lb < SUSPECT_MIN_LINES || tb <= 0) return false;
  return ln <= lb * SUSPECT_RATIO && tn <= tb * SUSPECT_RATIO;
}

/** Total d'un payload : celui annoncé, sinon positions + liquidités. */
export function payloadTotal(payload) {
  const t = num(payload.total_value_eur);
  if (t != null) return t;
  const pos = (payload.positions || []).reduce((s, p) => s + (num(p.value_eur) || 0), 0);
  return pos + (num(payload.cash_eur) || 0);
}
