const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const num = (d) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (d) => new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: d, minimumFractionDigits: d });

/**
 * Une valeur non affichable ? — vide, mais aussi NaN et ±Infinity.
 *
 * Ces deux-là naissent d'un simple `0 / 0` ou `x / 0`, situations banales dans un
 * portefeuille vide ou entièrement valorisé à zéro. `Intl.NumberFormat` les rend
 * littéralement « NaN % » et « ∞ % » : un tiret est plus honnête, et surtout ne
 * laisse pas croire à un chiffre.
 */
const unusable = (n) => n === null || n === undefined || n === '' || !Number.isFinite(Number(n));

export const fmtEur = (n) => (unusable(n) ? '—' : eur.format(Number(n)));
export const fmtNum = (n, d = 2) => (unusable(n) ? '—' : num(d).format(Number(n)));
export const fmtPct = (n, d = 1) => (unusable(n) ? '—' : pct(d).format(Number(n)));
/**
 * Date au format français (JJ/MM/AAAA).
 *
 * L'application affichait la date ISO brute — « au 2026-07-27 » — dans une
 * interface entièrement en français. Les valeurs inexploitables retombent sur la
 * chaîne d'origine plutôt que de disparaître.
 */
export function fmtDate(s) {
  if (!s) return '—';
  const iso = String(s).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Date courte (JJ/MM) — axes de graphiques, où la place manque. */
export function fmtDateShort(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${m[3]}/${m[2]}` : (s ? String(s).slice(0, 10) : '—');
}

/** Montant signé : « +1 234,00 € » / « -56,00 € », jamais « +-56,00 € ». */
export const fmtSignedEur = (n) => (unusable(n) ? '—' : `${Number(n) > 0 ? '+' : ''}${fmtEur(n)}`);

/** Classe de ton (positif/négatif) associée à une valeur, ou '' si indéterminée. */
export const toneOf = (n) => (unusable(n) || Number(n) === 0 ? '' : (Number(n) > 0 ? 'pos' : 'neg'));

/** Montant dans sa devise native (EUR, USD…). Repli si la devise est inconnue. */
export function fmtMoney(n, cur) {
  if (unusable(n)) return '—';
  if (/^[A-Z]{3}$/.test(cur || '')) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(Number(n));
  }
  return `${fmtNum(n)} ${cur || ''}`.trim();
}
