// Raccourcis vers les pages "finance" d'un titre, construits depuis son ticker
// (rempli par l'enrichissement) ou, à défaut, son ISIN / nom.

const enc = encodeURIComponent;

export function yahooUrl({ ticker, isin }) {
  if (ticker) return `https://finance.yahoo.com/quote/${enc(ticker)}`;
  if (isin) return `https://finance.yahoo.com/lookup?s=${enc(isin)}`;
  return null;
}

/** Liste de raccourcis { label, url } pertinents pour un titre. */
export function stockLinks({ ticker, isin, name }) {
  const t = (ticker || '').trim();
  const base = t.split('.')[0]; // ticker sans suffixe de place (BABA, ATO…)
  const q = enc(`${name || isin || t} bourse`);
  const links = [];

  const yh = yahooUrl({ ticker: t, isin });
  if (yh) links.push({ label: 'Yahoo', url: yh });
  if (base) links.push({ label: 'Finviz', url: `https://finviz.com/quote.ashx?t=${enc(base)}` });
  if (base) links.push({ label: 'TradingView', url: `https://www.tradingview.com/symbols/${enc(base)}/` });
  if (isin) links.push({ label: 'Boursorama', url: `https://www.boursorama.com/recherche/?query=${enc(isin)}` });
  links.push({ label: 'Google', url: `https://www.google.com/search?q=${q}` });

  return links;
}
