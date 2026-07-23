import { Router } from 'express';
import { computeBenchmark, DEFAULT_BENCHMARK } from '../services/benchmark.js';

const router = Router();

// GET /api/benchmark?symbol=world — TWR du portefeuille vs benchmark buy-and-hold.
router.get('/', async (req, res, next) => {
  try {
    const key = String(req.query.symbol || DEFAULT_BENCHMARK).trim().toLowerCase();
    return res.json(await computeBenchmark(key));
  } catch (err) {
    return next(err);
  }
});

export default router;
