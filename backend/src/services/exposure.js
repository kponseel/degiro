import { getPool } from '../db/pool.js';

/** Libellé de la part non enrichie — partagé avec le front (légende + alerte). */
export const UNCLASSIFIED = 'Non classé';

/**
 * Agrège des positions par clé, pondéré par la valeur EUR.
 * Les positions sans clé sont regroupées sous `fallback` plutôt qu'exclues :
 * le dénominateur reste le portefeuille entier, sinon un poids de 100 % peut
 * ne représenter qu'une fraction du patrimoine.
 */
export function group(positions, keyFn, { fallback = 'Inconnu' } = {}) {
  const map = new Map();
  let total = 0;
  for (const p of positions) {
    const raw = keyFn(p);
    const key = raw || fallback;
    const value = Number(p.value_eur) || 0;
    map.set(key, (map.get(key) || 0) + value);
    total += value;
  }
  return [...map.entries()]
    .map(([key, value]) => ({ key, value, weight: total ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

/** Exposition du dernier snapshot par devise, classe d'actifs, secteur et pays. */
export async function computeExposure(accountId = 1) {
  const pool = getPool();
  const [snaps] = await pool.query(
    'SELECT id FROM snapshots WHERE account_id = ? ORDER BY captured_at DESC LIMIT 1',
    [accountId],
  );
  if (!snaps.length) return { currency: [], asset_class: [], sector: [], country: [] };

  const [positions] = await pool.query(
    `SELECT p.value_eur, p.currency, p.product_type,
            r.sector, r.country, r.asset_class
     FROM positions p
     LEFT JOIN isin_ref r ON r.isin = p.isin
     WHERE p.snapshot_id = ? AND (p.qty IS NULL OR p.qty <> 0)`,
    [snaps[0].id],
  );

  return {
    currency: group(positions, (p) => p.currency),
    asset_class: group(positions, (p) => p.asset_class || p.product_type || 'Non typé'),
    sector: group(positions, (p) => p.sector, { fallback: UNCLASSIFIED }),
    country: group(positions, (p) => p.country, { fallback: UNCLASSIFIED }),
  };
}
