import { getPool } from '../db/pool.js';

/**
 * Dividendes perçus sur 12 mois glissants, depuis les mouvements du relevé de
 * compte (Account.csv). Agrège par devise (les dividendes étrangers ne sont pas
 * convertis) et par titre. Le « net » retranche la retenue à la source.
 */
export async function computeDividends(accountId = 1) {
  const pool = getPool();
  const now = new Date();
  const from = new Date(now);
  from.setFullYear(now.getFullYear() - 1);
  const fromStr = `${from.toISOString().slice(0, 10)} 00:00:00`;

  const [rows] = await pool.query(
    // Le nom du titre est repris des positions DU COMPTE : `positions` n'a pas de
    // colonne account_id, il faut donc remonter à `snapshots`. Sans cette
    // jointure, la sous-requête piochait dans les positions de n'importe quel
    // inscrit détenant le même ISIN — le libellé affiché venait alors du
    // portefeuille d'autrui.
    `SELECT t.type, t.currency, t.isin, t.description, t.amount,
            (SELECT p.name FROM positions p
               JOIN snapshots s ON s.id = p.snapshot_id
              WHERE p.isin = t.isin AND s.account_id = t.account_id
              ORDER BY p.id DESC LIMIT 1) AS name
     FROM transactions t
     WHERE t.account_id = ? AND t.type IN ('dividend', 'tax') AND t.tx_date >= ?`,
    [accountId, fromStr],
  );

  const byCurrency = new Map();
  const byIsin = new Map();
  let count = 0;

  for (const r of rows) {
    const cur = r.currency || '—';
    if (!byCurrency.has(cur)) byCurrency.set(cur, { currency: cur, gross: 0, tax: 0 });
    const bucket = byCurrency.get(cur);
    const amt = Number(r.amount) || 0;

    if (r.type === 'dividend') {
      bucket.gross += amt;
      count += 1;
      const key = r.isin || r.description || '—';
      if (!byIsin.has(key)) {
        byIsin.set(key, { isin: r.isin || null, name: r.name || r.description || r.isin || '—', currency: cur, gross: 0 });
      }
      byIsin.get(key).gross += amt;
    } else {
      bucket.tax += amt; // négatif
    }
  }

  const currencies = [...byCurrency.values()]
    .map((c) => ({ ...c, net: c.gross + c.tax }))
    .sort((a, b) => b.gross - a.gross);

  const payers = [...byIsin.values()].sort((a, b) => b.gross - a.gross);

  return {
    window: { from: fromStr.slice(0, 10), to: now.toISOString().slice(0, 10) },
    currencies,
    payers,
    count,
  };
}
