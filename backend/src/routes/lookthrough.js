import { Router } from 'express';
import { computeLookthrough } from '../services/lookthrough.js';

const router = Router();

// GET /api/lookthrough — vraie exposition par titre (ETF éclatés) + surexpositions.
router.get('/', async (_req, res, next) => {
  try {
    return res.json(await computeLookthrough());
  } catch (err) {
    return next(err);
  }
});

export default router;
