import { Router } from 'express';
import { getPool } from '../db/pool.js';

const router = Router();

// GET /api/snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD
// Série de valeur totale par jour. À date égale, l'extension prime sur le CSV.
router.get('/', async (req, res, next) => {
  try {
    const clauses = ['account_id = ?'];
    const params = [req.user.id];
    if (req.query.from) {
      clauses.push('snapshot_date >= ?');
      params.push(req.query.from);
    }
    if (req.query.to) {
      clauses.push('snapshot_date <= ?');
      params.push(req.query.to);
    }
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT snapshot_date, source, total_value_eur, cash_eur
       FROM snapshots WHERE ${clauses.join(' AND ')}
       ORDER BY snapshot_date ASC, (source = 'extension') DESC`,
      params,
    );

    // Un point par jour : on garde la première ligne (extension prioritaire via le ORDER BY).
    const byDay = new Map();
    for (const row of rows) {
      if (!byDay.has(row.snapshot_date)) byDay.set(row.snapshot_date, row);
    }
    return res.json({ snapshots: [...byDay.values()] });
  } catch (err) {
    return next(err);
  }
});

export default router;
