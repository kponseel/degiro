import { logger } from '../logger.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

// Taxonomie sectorielle Yahoo (11 secteurs) → libellés français, alignés avec
// l'affichage de l'app (donut « Exposition par secteur »).
const SECTOR_FR = {
  'technology': 'Technologie',
  'financial services': 'Finance',
  'healthcare': 'Santé',
  'consumer cyclical': 'Consommation cyclique',
  'consumer defensive': 'Consommation de base',
  'communication services': 'Communication',
  'industrials': 'Industrie',
  'energy': 'Énergie',
  'basic materials': 'Matériaux',
  'utilities': 'Services publics',
  'real estate': 'Immobilier',
};

/** Normalise un secteur Yahoo (EN) en libellé FR ; renvoie tel quel si inconnu. */
export function mapSectorToFr(sector) {
  if (!sector) return null;
  const key = String(sector).trim().toLowerCase();
  return SECTOR_FR[key] || String(sector).trim();
}

/**
 * Extrait { symbol, sector, industry } du meilleur résultat « action » d'une
 * réponse de recherche Yahoo. Fonction pure (testable sans réseau).
 */
export function pickEquityQuote(json) {
  const quotes = Array.isArray(json?.quotes) ? json.quotes : [];
  const equities = quotes.filter((q) => q && q.quoteType === 'EQUITY' && q.symbol);
  if (!equities.length) return null;
  const q = equities.find((e) => e.sectorDisp || e.sector) || equities[0];
  return {
    symbol: q.symbol || null,
    sector: mapSectorToFr(q.sectorDisp || q.sector),
    industry: q.industryDisp || q.industry || null,
  };
}

async function searchIsin(isin) {
  const url =
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}` +
    '&quotesCount=6&newsCount=0&enableFuzzyQuery=false';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    return pickEquityQuote(await res.json());
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/** Exécute `fn` sur les items avec une concurrence bornée (anti rate-limit). */
async function withPool(items, size, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Résout secteur (+ ticker) pour une liste d'ISIN via Yahoo Finance.
 * Best-effort : réseau bloqué/indisponible → Map partielle ou vide, jamais bloquant.
 * @returns {Promise<Map<string, { sector: string|null, ticker: string|null, industry: string|null }>>}
 */
export async function lookupSectors(isins) {
  const map = new Map();
  if (!isins.length) return map;
  const results = await withPool(isins, 3, (isin) => searchIsin(isin));
  let hits = 0;
  results.forEach((r, i) => {
    if (r) {
      map.set(isins[i], { sector: r.sector, ticker: r.symbol, industry: r.industry });
      if (r.sector) hits += 1;
    }
  });
  if (isins.length) logger.info(`Yahoo : ${hits}/${isins.length} secteur(s) résolu(s)`);
  return map;
}
