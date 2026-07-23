import { Router } from 'express';
import { computeExposure } from '../services/exposure.js';

const router = Router();

// GET /api/exposure — répartitions du dernier snapshot.
// (Le look-through ETF viendra enrichir secteur/pays dans un incrément ultérieur.)
router.get('/', async (req, res, next) => {
  try {
    const exposure = await computeExposure(req.user.id);
    return res.json(exposure);
  } catch (err) {
    return next(err);
  }
});

export default router;
