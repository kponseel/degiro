import { Router } from 'express';
import { computeAnalytics } from '../services/analytics.js';

const router = Router();

// GET /api/analytics — attribution par titre, concentration, risque.
router.get('/', async (req, res, next) => {
  try {
    return res.json(await computeAnalytics(req.user.id));
  } catch (err) {
    return next(err);
  }
});

export default router;
