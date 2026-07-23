import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../db/pool.js';

const router = Router();
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

const patchSchema = z.object({
  sector: z.string().max(80).nullable().optional(),
  country: z.string().max(60).nullable().optional(),
  asset_class: z.string().max(40).nullable().optional(),
  ticker: z.string().max(20).nullable().optional(),
});

// GET /api/isin-ref — ISIN détenus (dernier snapshot) avec leur enrichissement.
router.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT p.isin, MAX(p.name) AS name,
              r.ticker, r.sector, r.country, r.asset_class, r.manual_override
       FROM positions p
       LEFT JOIN isin_ref r ON r.isin = p.isin
       WHERE p.snapshot_id = (SELECT id FROM snapshots WHERE account_id = ? ORDER BY captured_at DESC LIMIT 1)
       GROUP BY p.isin, r.ticker, r.sector, r.country, r.asset_class, r.manual_override
       ORDER BY name`,
      [req.user.id],
    );
    return res.json({ refs: rows });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/isin-ref/:isin — correction manuelle (fige manual_override = 1).
router.put('/:isin', async (req, res, next) => {
  const isin = String(req.params.isin).toUpperCase();
  if (!ISIN_RE.test(isin)) {
    return res.status(400).json({ error: 'ISIN invalide' });
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Champs invalides', details: parsed.error.flatten() });
  }
  const { sector = null, country = null, asset_class = null, ticker = null } = parsed.data;
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO isin_ref (isin, ticker, sector, country, asset_class, manual_override, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE
         ticker = VALUES(ticker), sector = VALUES(sector), country = VALUES(country),
         asset_class = VALUES(asset_class), manual_override = 1, updated_at = NOW()`,
      [isin, ticker, sector, country, asset_class],
    );
    return res.json({ isin, sector, country, asset_class, ticker, manual_override: 1 });
  } catch (err) {
    return next(err);
  }
});

export default router;
