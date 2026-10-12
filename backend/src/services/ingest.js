import { getPool } from '../db/pool.js';
import { toMysqlUtc, parisCivilDate } from '../util/date.js';
import {
  isSuspectDrop, payloadTotal, SUSPECT_WINDOW_DAYS,
} from './plausibility.js';

/**
 * Dernière capture de la même source, dans la fenêtre récente, prise AVANT
 * celle-ci : le point de comparaison du garde-fou.
 */
async function previousForCheck(pool, accountId, source, capturedAt) {
  const since = new Date(capturedAt.getTime() - SUSPECT_WINDOW_DAYS * 86400000);
  const [rows] = await pool.query(
    `SELECT s.id, s.snapshot_date, s.total_value_eur, s.cash_eur,
            (SELECT COUNT(*) FROM positions p WHERE p.snapshot_id = s.id) AS line_count,
            (SELECT COALESCE(SUM(p.value_eur), 0) FROM positions p WHERE p.snapshot_id = s.id) AS positions_value
       FROM snapshots s
      WHERE s.account_id = ? AND s.source = ? AND s.captured_at <= ? AND s.captured_at >= ?
      ORDER BY s.captured_at DESC
      LIMIT 1`,
    [accountId, source, toMysqlUtc(capturedAt), toMysqlUtc(since)],
  );
  return rows[0] || null;
}

/**
 * Persiste un snapshot et ses positions pour un utilisateur (accountId).
 * - Idempotent par capture_id : un re-POST identique renvoie le snapshot existant.
 * - Un seul snapshot conservé par (jour civil, source) : le plus récent remplace l'ancien.
 * - Une capture d'extension qui ressemble à une lecture incomplète n'est PAS
 *   enregistrée (et ne remplace donc rien) sauf `force` : voir plausibility.js.
 *
 * @returns {Promise<{ snapshotId: number, deduplicated: boolean, replaced: boolean }
 *   | { suspect: { lines, total, previousLines, previousTotal, since } }>}
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

  // Garde-fou : réservé à l'extension. Un CSV est un import délibéré, relu en
  // prévisualisation avant d'être validé.
  if (source === 'extension' && payload.force !== true) {
    const prev = await previousForCheck(pool, accountId, source, capturedAt);
    if (prev) {
      const previousLines = Number(prev.line_count);
      const previousTotal = prev.total_value_eur != null
        ? Number(prev.total_value_eur)
        : Number(prev.positions_value) + Number(prev.cash_eur || 0);
      const lines = (payload.positions || []).length;
      const total = payloadTotal(payload);
      if (isSuspectDrop({ lines, total }, { lines: previousLines, total: previousTotal })) {
        return {
          suspect: {
            lines,
            total: Math.round(total * 100) / 100,
            previousLines,
            previousTotal: Math.round(previousTotal * 100) / 100,
            since: prev.snapshot_date,
          },
        };
      }
    }
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
         total_value_eur, cash_eur, net_deposits_eur, today_flow_eur, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        accountId,
        toMysqlUtc(capturedAt),
        snapshotDate,
        source,
        payload.capture_id,
        payload.schema_version ?? 1,
        payload.total_value_eur ?? null,
        payload.cash_eur ?? null,
        payload.net_deposits_eur ?? null,
        payload.today_flow_eur ?? null,
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
        p.pl_realized_eur ?? null,
      ]);
      await conn.query(
        `INSERT INTO positions
          (snapshot_id, isin, symbol, name, product_type, qty, price, currency, fx_rate,
           break_even_price, value_eur, pl_eur, pl_day_eur, pl_realized_eur)
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
