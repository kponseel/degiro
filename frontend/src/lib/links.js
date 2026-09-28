// Raccourcis vers les pages « finance » d'un titre, construits depuis son ticker
// (rempli par l'enrichissement) ou, à défaut, son ISIN / nom.
//
// Pourquoi des liens plutôt qu'un flux récupéré côté serveur : l'application
// tourne sur un hébergement mutualisé dont les appels sortants sont filtrés ou
// limités en débit. Les sources publiques d'actualité y refusaient nos requêtes,
// et l'écran restait figé sur un cache périmé sans jamais dire pourquoi. Le
// navigateur de l'utilisateur, lui, n'est bloqué par personne : lui donner le
// lien marche toujours, ne périme pas, et ne demande aucune clé d'API.

const enc = encodeURIComponent;

export function yahooUrl({ ticker, isin }) {
  if (ticker) return `https://finance.yahoo.com/quote/${enc(ticker)}`;
  if (isin) return `https://finance.yahoo.com/lookup?s=${enc(isin)}`;
  return null;
}

/** Terme de recherche le plus parlant dont on dispose pour ce titre. */
function terme({ name, isin, ticker }) {
  return (name || isin || ticker || '').trim();
}

/**
 * Liens d'ACTUALITÉ pour un titre : ce qui remplace le flux d'articles.
 *
 * Google News en français d'abord — c'est la source que nous interrogions, mais
 * consultée depuis le navigateur elle ne peut plus être refusée. Les autres
 * couvrent des angles différents : Boursorama pour la presse financière
 * francophone, Yahoo pour les communiqués et résultats en anglais.
 */
export function newsLinks(stock) {
  const q = terme(stock);
  if (!q) return [];
  const t = (stock.ticker || '').trim();
  const liens = [
    { label: 'Google News', url: `https://news.google.com/search?q=${enc(q)}&hl=fr&gl=FR&ceid=FR:fr` },
    { label: 'Google Finance', url: `https://www.google.com/finance/quote/${enc(t || q)}` },
  ];
  if (stock.isin) {
    liens.push({ label: 'Boursorama', url: `https://www.boursorama.com/recherche/?query=${enc(stock.isin)}` });
  }
  const yh = yahooUrl(stock);
  if (yh) liens.push({ label: 'Yahoo Finance', url: yh });
  return liens;
}

/**
 * Les deux rangées d'un titre : actualité d'abord, pages de données ensuite.
 *
 * Les deux listes se recoupaient — Boursorama et Yahoo figuraient dans chacune,
 * donc deux fois sous chaque titre. On dédoublonne par SERVICE (le domaine), pas
 * par libellé : « Yahoo Finance » et « Yahoo » mènent au même endroit sous deux
 * noms, et c'est l'adresse qui fait foi.
 */
export function raccourcisTitre(stock) {
  const actu = newsLinks(stock);
  const vus = new Set(actu.map((l) => hote(l.url)));
  const donnees = stockLinks(stock).filter((l) => {
    const h = hote(l.url);
    if (vus.has(h)) return false;
    vus.add(h);
    return true;
  });
  return { actu, donnees };
}

/** Domaine d'une URL, ou la chaîne entière si elle n'est pas analysable. */
function hote(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url);
  }
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

/**
 * Raccourcis de marché, sans rapport avec une ligne précise.
 *
 * Regroupés par intention plutôt que par éditeur : on ouvre « les marchés ce
 * matin » ou « le calendrier des résultats », pas « Boursorama ».
 */
export const MARCHE = [
  {
    groupe: 'Actualité des marchés',
    liens: [
      { label: 'Google News — Bourse', url: 'https://news.google.com/search?q=bourse%20march%C3%A9s&hl=fr&gl=FR&ceid=FR:fr' },
      { label: 'Boursorama', url: 'https://www.boursorama.com/bourse/actualites/' },
      { label: 'Les Échos Investir', url: 'https://investir.lesechos.fr/' },
      { label: 'Reuters Markets', url: 'https://www.reuters.com/markets/' },
    ],
  },
  {
    groupe: 'Indices et cours',
    liens: [
      { label: 'CAC 40', url: 'https://www.google.com/finance/quote/PX1:INDEXEURO' },
      { label: 'S&P 500', url: 'https://www.google.com/finance/quote/.INX:INDEXSP' },
      { label: 'Nasdaq', url: 'https://www.google.com/finance/quote/IXIC:INDEXNASDAQ' },
      { label: 'TradingView', url: 'https://www.tradingview.com/markets/' },
    ],
  },
  {
    groupe: 'Agenda et données',
    liens: [
      { label: 'Résultats à venir', url: 'https://finance.yahoo.com/calendar/earnings' },
      { label: 'Agenda économique', url: 'https://www.investing.com/economic-calendar/' },
      { label: 'Dividendes', url: 'https://www.boursorama.com/bourse/actions/palmares/dividendes/' },
      { label: 'Change EUR/USD', url: 'https://www.google.com/finance/quote/EUR-USD' },
    ],
  },
];
