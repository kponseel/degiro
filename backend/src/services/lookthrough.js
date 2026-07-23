import { getPool } from '../db/pool.js';

/**
 * Exposition « look-through » : éclate chaque ETF détenu en ses constituants
 * (si sa composition est importée) pour révéler la vraie exposition par titre —
 * notamment les surexpositions cachées (un titre détenu en direct ET via un ETF).
 */
export async function computeLookthrough(accountId = 1) {
  const pool = getPool();
  const [snaps] = await pool.query('SELECT id FROM snapshots WHERE account_id = ? ORDER BY captured_at DESC LIMIT 1', [accountId]);
  if (!snaps.length) return { total: 0, trueHoldings: [], overlaps: [], coveredCount: 0, missing: [] };

  const [positions] = await pool.query(
    `SELECT p.isin, p.name, p.product_type, p.value_eur, r.sector, r.country, r.asset_class
     FROM positions p LEFT JOIN isin_ref r ON r.isin = p.isin
     WHERE p.snapshot_id = ?`,
    [snaps[0].id],
  );
  const [holdingRows] = await pool.query(
    'SELECT etf_isin, constituent_name, constituent_isin, weight_pct, sector, country FROM etf_holdings',
  );

  const byEtf = new Map();
  for (const h of holdingRows) {
    if (!byEtf.has(h.etf_isin)) byEtf.set(h.etf_isin, []);
    byEtf.get(h.etf_isin).push(h);
  }

  const trueMap = new Map();
  const add = (key, name, isin, field, amount, sector, country) => {
    if (!trueMap.has(key)) {
      trueMap.set(key, { name, isin: isin || null, direct: 0, viaEtf: 0, sector: sector || null, country: country || null });
    }
    const e = trueMap.get(key);
    e[field] += amount;
    if (!e.sector && sector) e.sector = sector;
    if (!e.country && country) e.country = country;
  };

  const covered = [];
  const missing = [];
  let total = 0;

  for (const p of positions) {
    const v = Number(p.value_eur) || 0;
    total += v;
    const holdings = byEtf.get(p.isin);
    const looksEtf = p.asset_class === 'ETF' || p.product_type === 'ETF' || /ETF|UCITS|ETC/i.test(p.name || '');

    if (holdings && holdings.length) {
      covered.push(p.isin);
      let totalW = 0;
      for (const h of holdings) {
        const w = Number(h.weight_pct) || 0;
        totalW += w;
        const key = h.constituent_isin || `name:${h.constituent_name.toLowerCase()}`;
        add(key, h.constituent_name, h.constituent_isin, 'viaEtf', (v * w) / 100, h.sector, h.country);
      }
      const residualW = Math.max(0, 100 - totalW);
      if (residualW > 0.5) {
        add(`etfrest:${p.isin}`, `${p.name || p.isin} · reste`, null, 'viaEtf', (v * residualW) / 100, null, null);
      }
    } else {
      if (looksEtf) missing.push({ isin: p.isin, name: p.name });
      const key = p.isin || `name:${(p.name || '').toLowerCase()}`;
      add(key, p.name || p.isin, p.isin, 'direct', v, p.sector, p.country);
    }
  }

  const trueHoldings = [...trueMap.values()]
    .map((e) => ({ ...e, total: e.direct + e.viaEtf, weight: total ? (e.direct + e.viaEtf) / total : 0 }))
    .sort((a, b) => b.total - a.total);

  // Surexpositions : détenu en direct ET via un ETF.
  const overlaps = trueHoldings.filter((e) => e.direct > 0.005 && e.viaEtf > 0.005);

  return { total, trueHoldings, overlaps, coveredCount: covered.length, missing };
}
