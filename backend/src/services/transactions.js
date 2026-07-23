import { getPool } from '../db/pool.js';

/**
 * Enregistre des mouvements (relevé de compte ou ordres) pour un utilisateur.
 * Idempotent via external_id (INSERT IGNORE sur la contrainte d'unicité).
 * @returns {Promise<{ received: number, inserted: number }>}
 */
export async function saveTransactions(txs, accountId = 1) {
  if (!txs.length) return { received: 0, inserted: 0 };
  const pool = getPool();
  const rows = txs.map((t) => [
    accountId,
    t.tx_date,
    t.type,
    t.isin ?? null,
    t.description ?? null,
    t.qty ?? null,
    t.amount ?? null,
    t.currency ?? null,
    t.amount_eur ?? null,
    t.external_id,
  ]);
  const [res] = await pool.query(
    `INSERT IGNORE INTO transactions
       (account_id, tx_date, type, isin, description, qty, amount, currency, amount_eur, external_id)
     VALUES ?`,
    [rows],
  );
  return { received: txs.length, inserted: res.affectedRows };
}
