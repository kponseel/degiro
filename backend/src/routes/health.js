import { Router } from 'express';
import { pingDb } from '../db/pool.js';
import { config } from '../config.js';
import { mailerMode } from '../services/mailer.js';

const router = Router();

// GET /api/health — sondage de disponibilité (sans authentification, sans donnée sensible).
// Renvoie toujours 200 pour le monitoring ; le champ `db` reflète l'état de la base.
router.get('/', async (_req, res) => {
  const db = await pingDb();
  res.status(200).json({
    status: 'ok',
    db: db.ok ? 'up' : 'down',
    // Diagnostic d'un db:down (sans donnée sensible) : code d'erreur + host d'origine
    // vu par MySQL en cas de refus d'accès (utile pour l'allowlist Remote MySQL).
    ...(db.ok ? {} : { db_error: db.code, ...(db.deniedFrom ? { db_denied_from: db.deniedFrom } : {}) }),
    // Mode d'envoi d'email : 'smtp' = liens magiques réellement expédiés,
    // 'dev' = SMTP non configuré (le lien est journalisé/renvoyé en dev).
    email: mailerMode(),
    version: config.version || process.env.npm_package_version || '0.1.0',
    ts: new Date().toISOString(),
  });
});

export default router;
