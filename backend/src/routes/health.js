import { Router } from 'express';
import { pingDb } from '../db/pool.js';
import { config } from '../config.js';
import { mailerMode } from '../services/mailer.js';

const router = Router();

/**
 * Le diagnostic détaillé (code d'erreur MySQL, hôte refusé, état SMTP) renseigne
 * un attaquant sur l'infrastructure et sur le fait qu'aucun email ne part. Il
 * reste disponible — c'est lui qui sert à régler l'allowlist Remote MySQL — mais
 * seulement pour qui présente le jeton de service, ou en développement.
 */
function maySeeDetails(req) {
  if (config.isDevOrTest) return true;
  const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  return Boolean(config.apiToken) && m?.[1]?.trim() === config.apiToken;
}

// GET /api/health — sondage de disponibilité (sans authentification).
// Renvoie toujours 200 pour le monitoring ; le champ `db` reflète l'état de la base.
router.get('/', async (req, res) => {
  const db = await pingDb();
  const details = maySeeDetails(req);
  res.status(200).json({
    status: 'ok',
    db: db.ok ? 'up' : 'down',
    ...(db.ok || !details
      ? {}
      : { db_error: db.code, ...(db.deniedFrom ? { db_denied_from: db.deniedFrom } : {}) }),
    ...(details ? { email: mailerMode() } : {}),
    version: config.version || process.env.npm_package_version || '0.1.0',
    ts: new Date().toISOString(),
  });
});

export default router;
