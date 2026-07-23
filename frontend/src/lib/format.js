const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const num = (d) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (d) => new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: d, minimumFractionDigits: d });

export const fmtEur = (n) => (n === null || n === undefined || n === '' ? '—' : eur.format(Number(n)));
export const fmtNum = (n, d = 2) => (n === null || n === undefined || n === '' ? '—' : num(d).format(Number(n)));
export const fmtPct = (n, d = 1) => (n === null || n === undefined || n === '' ? '—' : pct(d).format(Number(n)));
export const fmtDate = (s) => (s ? String(s).slice(0, 10) : '—');

/** Montant dans sa devise native (EUR, USD…). Repli si la devise est inconnue. */
export function fmtMoney(n, cur) {
  if (n === null || n === undefined || n === '') return '—';
  if (/^[A-Z]{3}$/.test(cur || '')) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(Number(n));
  }
  return `${fmtNum(n)} ${cur || ''}`.trim();
}
