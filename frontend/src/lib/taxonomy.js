/**
 * Taxonomie commune : secteurs, pays, régions, devise économique.
 *
 * Module PUR, testé depuis le backend. Deux sources se rencontrent ici et ne
 * parlent pas la même langue : les références ISIN de l'application (secteurs
 * Yahoo traduits, pays déduits de l'ISIN — en français) et les compositions
 * d'ETF importées (iShares, Amundi… — souvent en anglais, en GICS). Sans cette
 * normalisation, « Technologie » et « Information Technology » formaient deux
 * secteurs distincts, et la vraie exposition se lisait moitié-moitié.
 */

const norm = (s) => String(s ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── Secteurs ─────────────────────────────────────────────────────────

/** Libellés canoniques, ceux qu'affiche déjà l'application (taxonomie Yahoo traduite). */
export const SECTORS = [
  'Technologie', 'Finance', 'Santé', 'Consommation cyclique', 'Consommation de base',
  'Communication', 'Industrie', 'Énergie', 'Matériaux', 'Services publics', 'Immobilier',
];

const SECTOR_ALIASES = {
  Technologie: ['technology', 'information technology', 'it', 'technologie de l information',
    'technologies de l information', 'tech'],
  Finance: ['financial services', 'financials', 'financial', 'finances', 'services financiers', 'banks'],
  'Santé': ['healthcare', 'health care', 'sante', 'soins de sante'],
  'Consommation cyclique': ['consumer cyclical', 'consumer discretionary', 'consommation discretionnaire',
    'biens de consommation cyclique', 'consommation non essentielle'],
  'Consommation de base': ['consumer defensive', 'consumer staples', 'biens de consommation de base',
    'consommation courante', 'produits de premiere necessite'],
  Communication: ['communication services', 'communication', 'communications', 'services de communication',
    'telecommunication services', 'telecommunications'],
  Industrie: ['industrials', 'industrial', 'industrie', 'industries'],
  'Énergie': ['energy', 'energie'],
  'Matériaux': ['basic materials', 'materials', 'materiaux', 'materiels'],
  'Services publics': ['utilities', 'services aux collectivites', 'services publics'],
  Immobilier: ['real estate', 'immobilier'],
};
const SECTOR_INDEX = new Map(
  Object.entries(SECTOR_ALIASES).flatMap(([canon, aliases]) => [[norm(canon), canon], ...aliases.map((a) => [norm(a), canon])]),
);

/** Poche de liquidités à l'intérieur d'un ETF (« Cash and/or Derivatives »). */
export const ETF_CASH = 'Liquidités (dans les ETF)';

/** Secteur canonique, ou le libellé d'origine s'il est inconnu (jamais inventé). */
export function normalizeSector(raw) {
  const k = norm(raw).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!k || k === '-' || k === 'n a' || k === 'other' || k === 'autre') return null;
  if (/cash|derivative|liquidit|money market|monetaire/.test(k)) return ETF_CASH;
  return SECTOR_INDEX.get(k) || String(raw).trim();
}

// ── Pays et régions ──────────────────────────────────────────────────

// Anglais (compositions d'ETF) → libellés français de l'application.
const COUNTRY_EN = {
  'united states': 'États-Unis', usa: 'États-Unis', us: 'États-Unis', 'united states of america': 'États-Unis',
  canada: 'Canada', mexico: 'Mexique', brazil: 'Brésil', chile: 'Chili', argentina: 'Argentine',
  'united kingdom': 'Royaume-Uni', uk: 'Royaume-Uni', 'great britain': 'Royaume-Uni',
  france: 'France', germany: 'Allemagne', netherlands: 'Pays-Bas', switzerland: 'Suisse', spain: 'Espagne',
  italy: 'Italie', belgium: 'Belgique', sweden: 'Suède', denmark: 'Danemark', finland: 'Finlande',
  norway: 'Norvège', austria: 'Autriche', portugal: 'Portugal', ireland: 'Irlande', luxembourg: 'Luxembourg',
  poland: 'Pologne', greece: 'Grèce', israel: 'Israël', 'czech republic': 'Tchéquie', hungary: 'Hongrie',
  japan: 'Japon', australia: 'Australie', 'new zealand': 'Nouvelle-Zélande', 'hong kong': 'Hong Kong',
  singapore: 'Singapour', china: 'Chine', taiwan: 'Taïwan', india: 'Inde', 'south korea': 'Corée du Sud',
  korea: 'Corée du Sud', 'korea (south)': 'Corée du Sud', 'korea, republic of': 'Corée du Sud',
  indonesia: 'Indonésie', thailand: 'Thaïlande', malaysia: 'Malaisie', philippines: 'Philippines',
  'south africa': 'Afrique du Sud', 'saudi arabia': 'Arabie saoudite', 'united arab emirates': 'Émirats arabes unis',
  qatar: 'Qatar', kuwait: 'Koweït', turkey: 'Turquie', peru: 'Pérou', colombia: 'Colombie',
};
const COUNTRY_FR = new Map(Object.values(COUNTRY_EN).map((fr) => [norm(fr), fr]));

/** Pays en français, quelle que soit la langue de la source. */
export function normalizeCountry(raw) {
  const k = norm(raw).replace(/\s+/g, ' ');
  if (!k || k === '-' || k === 'n/a' || k === 'other' || k === 'autre') return null;
  if (/cash|derivative|liquidit/.test(k)) return null;
  const hit = COUNTRY_EN[k] || COUNTRY_FR.get(k);
  return hit || String(raw).trim();
}

export const REGIONS = ['Amérique du Nord', 'Europe', 'Asie-Pacifique développée', 'Émergents', 'Autres'];

const REGION_OF = {
  'Amérique du Nord': ['États-Unis', 'Canada'],
  Europe: ['Royaume-Uni', 'France', 'Allemagne', 'Pays-Bas', 'Suisse', 'Espagne', 'Italie', 'Belgique', 'Suède',
    'Danemark', 'Finlande', 'Norvège', 'Autriche', 'Portugal', 'Irlande', 'Luxembourg', 'Israël'],
  'Asie-Pacifique développée': ['Japon', 'Australie', 'Nouvelle-Zélande', 'Hong Kong', 'Singapour'],
  // Classement MSCI : Corée du Sud et Taïwan restent « émergents ».
  'Émergents': ['Chine', 'Taïwan', 'Inde', 'Corée du Sud', 'Brésil', 'Mexique', 'Chili', 'Argentine', 'Pologne',
    'Grèce', 'Tchéquie', 'Hongrie', 'Indonésie', 'Thaïlande', 'Malaisie', 'Philippines', 'Afrique du Sud',
    'Arabie saoudite', 'Émirats arabes unis', 'Qatar', 'Koweït', 'Turquie', 'Pérou', 'Colombie'],
};
const REGION_INDEX = new Map(Object.entries(REGION_OF).flatMap(([r, cs]) => cs.map((c) => [c, r])));

/** Région d'un pays (déjà normalisé), `null` si inconnu. */
export function regionOf(country) {
  const c = normalizeCountry(country);
  if (!c) return null;
  return REGION_INDEX.get(c) || 'Autres';
}

// Devise « économique » d'une société, approchée par son pays : un ETF MSCI World
// coté en euros reste exposé aux trois quarts au dollar. La devise de cotation,
// seule, sous-estime ce risque de change.
const EURO_ZONE = new Set(['France', 'Allemagne', 'Pays-Bas', 'Espagne', 'Italie', 'Belgique', 'Finlande',
  'Autriche', 'Portugal', 'Irlande', 'Luxembourg', 'Grèce']);
const CURRENCY_OF = {
  'États-Unis': 'USD', Canada: 'CAD', 'Royaume-Uni': 'GBP', Suisse: 'CHF', Japon: 'JPY', Australie: 'AUD',
  'Nouvelle-Zélande': 'NZD', 'Hong Kong': 'HKD', Singapour: 'SGD', Suède: 'SEK', Danemark: 'DKK', Norvège: 'NOK',
  Chine: 'CNY', 'Taïwan': 'TWD', Inde: 'INR', 'Corée du Sud': 'KRW', 'Brésil': 'BRL', Mexique: 'MXN',
  'Israël': 'ILS', Pologne: 'PLN', 'Afrique du Sud': 'ZAR',
};

/** Devise économique d'un pays, `null` si inconnu. */
export function currencyOfCountry(country) {
  const c = normalizeCountry(country);
  if (!c) return null;
  if (EURO_ZONE.has(c)) return 'EUR';
  return CURRENCY_OF[c] || 'Autres devises';
}

// ── Fonds ────────────────────────────────────────────────────────────

// Même règle que le look-through côté serveur : `\b` obligatoire, « NETFLIX »
// contient « ETF » et passait pour un fonds.
const FUND_NAME = /\b(ETF|UCITS|ETC|ISHARES|XTRACKERS|LYXOR|AMUNDI|VANGUARD|SPDR|INVESCO|WISDOMTREE|VANECK)\b/i;

/** Vrai pour un ETF / ETC / fonds — dont le pays n'est qu'une domiciliation. */
export function isFund(p) {
  const t = String(p?.asset_class || p?.product_type || '').toUpperCase();
  if (t === 'ETF' || t === 'ETC' || t === 'FUND' || t === 'FONDS') return true;
  if (t === 'ACTION' || t === 'STOCK') return false;
  return FUND_NAME.test(p?.name || '');
}
