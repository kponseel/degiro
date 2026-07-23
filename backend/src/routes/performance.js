import { Router } from 'express';
import { computePerformance } from '../services/performance.js';

const router = Router();

// GET /api/performance — TWR (Dietz modifié chaîné) + série cumulée.
router.get('/', async (_req, res, next) => {
  try {
    const result = await computePerformance();
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

export default router;
