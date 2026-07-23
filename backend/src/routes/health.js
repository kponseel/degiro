import { Router } from 'express';
import { pingDb } from '../db/pool.js';
import { config } from '../config.js';

const router = Router();

// GET /api/health — sondage de disponibilité (sans authentification, sans donnée sensible).
// Renvoie toujours 200 pour le monitoring ; le champ `db` reflète l'état de la base.
router.get('/', async (_req, res) => {
  const dbUp = await pingDb();
  res.status(200).json({
    status: 'ok',
    db: dbUp ? 'up' : 'down',
    version: config.version || process.env.npm_package_version || '0.1.0',
    ts: new Date().toISOString(),
  });
});

export default router;
