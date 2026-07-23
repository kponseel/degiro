import { getPool } from '../db/pool.js';

/** Agrège des positions par clé, pondéré par la valeur EUR. */
export function group(positions, keyFn, { skipNull = false } = {}) {
  const map = new Map();
  let total = 0;
  for (const p of positions) {
    const raw = keyFn(p);
    if (skipNull && (raw === null || raw === undefined || raw === '')) continue;
    const key = raw || 'Inconnu';
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
     WHERE p.snapshot_id = ?`,
    [snaps[0].id],
  );

  return {
    currency: group(positions, (p) => p.currency),
    asset_class: group(positions, (p) => p.asset_class || p.product_type || 'Non typé'),
    sector: group(positions, (p) => p.sector, { skipNull: true }),
    country: group(positions, (p) => p.country, { skipNull: true }),
  };
}
