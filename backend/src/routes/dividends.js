import { Router } from 'express';
import { computeDividends } from '../services/dividends.js';

const router = Router();

// GET /api/dividends — dividendes perçus sur 12 mois glissants (depuis Account.csv).
router.get('/', async (req, res, next) => {
  try {
    const result = await computeDividends(req.user.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

export default router;
