import { getPool } from '../db/pool.js';
import { toMysqlUtc, parisCivilDate } from '../util/date.js';

/**
 * Persiste un snapshot et ses positions pour un utilisateur (accountId).
 * - Idempotent par capture_id : un re-POST identique renvoie le snapshot existant.
 * - Un seul snapshot conservé par (jour civil, source) : le plus récent remplace l'ancien.
 *
 * @returns {Promise<{ snapshotId: number, deduplicated: boolean, replaced: boolean }>}
 */
export async function ingestSnapshot(payload, accountId = 1) {
  const pool = getPool();
  const capturedAt = new Date(payload.captured_at);
  const snapshotDate = parisCivilDate(capturedAt);
  const { source } = payload;

  // Idempotence par (utilisateur, capture_id).
  const [existing] = await pool.query(
    'SELECT id FROM snapshots WHERE account_id = ? AND capture_id = ?',
    [accountId, payload.capture_id],
  );
  if (existing.length) {
    return { snapshotId: existing[0].id, deduplicated: true, replaced: false };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Un snapshot par jour et par source : on supprime l'éventuel existant (positions en cascade).
    const [del] = await conn.query(
      'DELETE FROM snapshots WHERE account_id = ? AND snapshot_date = ? AND source = ?',
      [accountId, snapshotDate, source],
    );

    const [snapRes] = await conn.query(
      `INSERT INTO snapshots
        (account_id, captured_at, snapshot_date, source, capture_id, schema_version,
         total_value_eur, cash_eur, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        accountId,
        toMysqlUtc(capturedAt),
        snapshotDate,
        source,
        payload.capture_id,
        payload.schema_version ?? 1,
        payload.total_value_eur ?? null,
        payload.cash_eur ?? null,
        payload.raw_json !== undefined ? JSON.stringify(payload.raw_json) : null,
      ],
    );
    const snapshotId = snapRes.insertId;

    if (payload.positions?.length) {
      const rows = payload.positions.map((p) => [
        snapshotId,
        p.isin,
        p.symbol ?? null,
        p.name ?? null,
        p.product_type ?? null,
        p.qty ?? null,
        p.price ?? null,
        p.currency ?? null,
        p.fx_rate ?? null,
        p.break_even_price ?? null,
        p.value_eur ?? null,
        p.pl_eur ?? null,
        p.pl_day_eur ?? null,
      ]);
      await conn.query(
        `INSERT INTO positions
          (snapshot_id, isin, symbol, name, product_type, qty, price, currency, fx_rate,
           break_even_price, value_eur, pl_eur, pl_day_eur)
         VALUES ?`,
        [rows],
      );
    }

    await conn.commit();
    return { snapshotId, deduplicated: false, replaced: del.affectedRows > 0 };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
