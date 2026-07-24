import { Router } from 'express';
import { computeNews } from '../services/news.js';

const router = Router();

// GET /api/news?symbol=ISIN&refresh=1 — actualités des titres du portefeuille.
router.get('/', async (req, res, next) => {
  try {
    const symbol = req.query.symbol ? String(req.query.symbol).trim().toUpperCase() : null;
    const force = req.query.refresh === '1';
    return res.json(await computeNews(req.user.id, { symbol, force }));
  } catch (err) {
    return next(err);
  }
});

export default router;
