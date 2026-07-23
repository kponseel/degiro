import { Router } from 'express';
import { enrichPortfolio } from '../services/enrich.js';

const router = Router();

// POST /api/enrich — enrichit les ISIN du dernier snapshot.
router.post('/', async (req, res, next) => {
  try {
    const result = await enrichPortfolio(req.user.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

export default router;
