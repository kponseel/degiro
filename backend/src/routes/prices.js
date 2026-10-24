import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { toMysqlUtc } from '../util/date.js';

const router = Router();

// Un point : ["AAAA-MM-JJ", valeur > 0]. Bornes larges mais finies : 5 ans au
// jour près tiennent dans 2 000 points.
const point = z.tuple([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.number().finite().positive().max(1e12),
]);
const points = z.array(point).max(2000).default([]);

const pricesSchema = z.object({
  fetched_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'date invalide' }),
  series: z.array(z.object({
    isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/),
    currency: z.string().length(3).optional().nullable(),
    daily: points,
    weekly: points,
  })).max(300),
  fx: z.array(z.object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    rates: points,
  })).max(40).default([]),
});

// POST /api/prices — historique des cours et taux BCE envoyés par l'extension
// après une capture. Remplace, ligne par ligne, ce qui était enregistré.
router.post('/', async (req, res, next) => {
  const parsed = pricesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Historique invalide', details: parsed.error.flatten() });
  }
  const { fetched_at: fetchedAt, series, fx } = parsed.data;
  const at = toMysqlUtc(new Date(fetchedAt));
  try {
    const pool = getPool();
    const rows = series
      .filter((s) => s.daily.length || s.weekly.length)
      .map((s) => [req.user.id, s.isin, s.currency || null, JSON.stringify(s.daily), JSON.stringify(s.weekly), at]);
    if (rows.length) {
      await pool.query(
        `INSERT INTO price_history (account_id, isin, currency, daily_json, weekly_json, fetched_at)
         VALUES ? ON DUPLICATE KEY UPDATE currency = VALUES(currency), daily_json = VALUES(daily_json),
           weekly_json = VALUES(weekly_json), fetched_at = VALUES(fetched_at)`,
        [rows],
      );
    }
    const fxRows = fx.filter((f) => f.rates.length)
      .map((f) => [req.user.id, f.currency, JSON.stringify(f.rates), at]);
    if (fxRows.length) {
      await pool.query(
        `INSERT INTO fx_history (account_id, currency, rates_json, fetched_at)
         VALUES ? ON DUPLICATE KEY UPDATE rates_json = VALUES(rates_json), fetched_at = VALUES(fetched_at)`,
        [fxRows],
      );
    }
    return res.status(201).json({ series: rows.length, fx: fxRows.length });
  } catch (err) {
    return next(err);
  }
});

const parse = (txt) => {
  try { return JSON.parse(txt || '[]'); } catch { return []; }
};

// GET /api/prices — historique enregistré pour l'utilisateur connecté.
router.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const [series] = await pool.query(
      'SELECT isin, currency, daily_json, weekly_json, fetched_at FROM price_history WHERE account_id = ?',
      [req.user.id],
    );
    const [fx] = await pool.query(
      'SELECT currency, rates_json FROM fx_history WHERE account_id = ?',
      [req.user.id],
    );
    return res.json({
      series: series.map((s) => ({
        isin: s.isin, currency: s.currency, fetched_at: s.fetched_at, daily: parse(s.daily_json), weekly: parse(s.weekly_json),
      })),
      fx: Object.fromEntries(fx.map((f) => [f.currency, parse(f.rates_json)])),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
