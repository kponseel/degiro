import { Router } from 'express';
import { computeNews } from '../services/news.js';

const router = Router();

// GET /api/news — titres détenus, pour les raccourcis de la page Actus.
router.get('/', async (req, res, next) => {
  try {
    return res.json(await computeNews(req.user.id));
  } catch (err) {
    return next(err);
  }
});

export default router;
