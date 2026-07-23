import { Router } from 'express';
import { getPool } from '../db/pool.js';

const router = Router();

// GET /api/portfolio — positions du dernier snapshot, enrichies par ISIN.
router.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const [snaps] = await pool.query(
      `SELECT id, captured_at, snapshot_date, source, total_value_eur, cash_eur
       FROM snapshots WHERE account_id = ?
       ORDER BY captured_at DESC LIMIT 1`,
      [req.user.id],
    );
    if (!snaps.length) {
      return res.json({ snapshot: null, positions: [] });
    }
    const snapshot = snaps[0];
    const [positions] = await pool.query(
      `SELECT p.isin, p.symbol, p.name, p.product_type, p.qty, p.price, p.currency,
              p.fx_rate, p.break_even_price, p.value_eur, p.pl_eur, p.pl_day_eur,
              r.sector, r.country, r.asset_class, r.ticker
       FROM positions p
       LEFT JOIN isin_ref r ON r.isin = p.isin
       WHERE p.snapshot_id = ?
       ORDER BY p.value_eur DESC`,
      [snapshot.id],
    );
    return res.json({ snapshot, positions });
  } catch (err) {
    return next(err);
  }
});

export default router;
