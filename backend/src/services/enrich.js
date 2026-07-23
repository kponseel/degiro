import { getPool } from '../db/pool.js';

// Pays de rattachement d'après le préfixe ISO de l'ISIN.
// ⚠️ Pour les ETF (souvent IE/LU), c'est le pays de domiciliation, pas l'exposition réelle.
const COUNTRY_BY_PREFIX = {
  US: 'États-Unis', IE: 'Irlande', NL: 'Pays-Bas', FR: 'France', DE: 'Allemagne',
  GB: 'Royaume-Uni', LU: 'Luxembourg', CH: 'Suisse', ES: 'Espagne', IT: 'Italie',
  BE: 'Belgique', JP: 'Japon', CA: 'Canada', SE: 'Suède', DK: 'Danemark',
  FI: 'Finlande', NO: 'Norvège', AT: 'Autriche', PT: 'Portugal', AU: 'Australie',
  HK: 'Hong Kong', CN: 'Chine', KR: 'Corée du Sud', TW: 'Taïwan', IN: 'Inde', BR: 'Brésil',
};

export function countryFromIsin(isin) {
  if (!isin || isin.length < 2) return null;
  return COUNTRY_BY_PREFIX[isin.slice(0, 2).toUpperCase()] || null;
}

export function assetClassFromType(type) {
  if (!type) return null;
  const u = String(type).toUpperCase();
  if (u === 'ETF') return 'ETF';
  if (u === 'STOCK' || u === 'ACTION') return 'Action';
  return type;
}

/** Devine la classe d'actifs depuis le nom (utile pour les imports CSV sans type). */
export function assetClassFromName(name) {
  const n = String(name || '');
  if (/\betf\b|ucits|tracker/i.test(n)) return 'ETF';
  if (/\betc\b|physical (gold|silver|palladium|platinum|metal)/i.test(n)) return 'ETC';
  return null;
}

/** Résolution ISIN→ticker/secteur via OpenFIGI (best-effort, jamais bloquant). */
async function openFigiLookup(isins) {
  const map = new Map();
  if (!isins.length) return map;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.OPENFIGI_API_KEY) headers['X-OPENFIGI-APIKEY'] = process.env.OPENFIGI_API_KEY;
    const jobs = isins.map((isin) => ({ idType: 'ID_ISIN', idValue: isin }));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('https://api.openfigi.com/v3/mapping', {
      method: 'POST',
      headers,
      body: JSON.stringify(jobs),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return map;
    const data = await res.json();
    data.forEach((entry, i) => {
      const d = entry && entry.data && entry.data[0];
      if (d) map.set(isins[i], { ticker: d.ticker || null, sector: d.marketSector || null });
    });
  } catch {
    // Réseau indisponible / bloqué : on continue avec les seules données déterministes.
  }
  return map;
}

/**
 * Enrichit les ISIN du dernier snapshot : pays (préfixe ISIN), classe d'actifs
 * (type DEGIRO), ticker/secteur (OpenFIGI best-effort). Respecte manual_override.
 * @returns {Promise<{ enriched: number, skippedManual: number, source: string }>}
 */
export async function enrichPortfolio(accountId = 1) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT p.isin, MAX(p.product_type) AS product_type, MAX(p.name) AS name
     FROM positions p
     WHERE p.snapshot_id = (SELECT id FROM snapshots WHERE account_id = ? ORDER BY captured_at DESC LIMIT 1)
     GROUP BY p.isin`,
    [accountId],
  );
  if (!rows.length) return { enriched: 0, skippedManual: 0, source: 'none' };

  const [refRows] = await pool.query('SELECT isin FROM isin_ref WHERE manual_override = 1');
  const manual = new Set(refRows.map((r) => r.isin));
  const toEnrich = rows.filter((r) => !manual.has(r.isin));

  const figi = await openFigiLookup(toEnrich.map((r) => r.isin));

  for (const r of toEnrich) {
    const country = countryFromIsin(r.isin);
    // Type DEGIRO si présent (extension), sinon inférence par le nom, sinon Action par défaut.
    const assetClass =
      assetClassFromType(r.product_type) || assetClassFromName(r.name) || 'Action';
    const f = figi.get(r.isin) || {};
    await pool.query(
      `INSERT INTO isin_ref (isin, ticker, sector, country, asset_class, manual_override, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, NOW())
       ON DUPLICATE KEY UPDATE
         ticker = COALESCE(VALUES(ticker), ticker),
         sector = COALESCE(VALUES(sector), sector),
         country = COALESCE(VALUES(country), country),
         asset_class = COALESCE(VALUES(asset_class), asset_class),
         updated_at = NOW()`,
      [r.isin, f.ticker || null, f.sector || null, country, assetClass],
    );
  }

  return { enriched: toEnrich.length, skippedManual: manual.size, source: figi.size ? 'openfigi+isin' : 'isin' };
}
