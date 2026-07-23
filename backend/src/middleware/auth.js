import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/** Comparaison à temps constant de deux chaînes (protège des attaques temporelles). */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Comparaison factice pour ne pas court-circuiter sur la longueur.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Exige un jeton bearer valide (Authorization: Bearer <API_TOKEN>).
 * Protège toutes les routes /api sauf /api/health (santé publique).
 */
export function requireAuth(req, res, next) {
  const expected = config.apiToken;
  if (!expected) {
    // Refuse plutôt que de tourner « ouvert » si le jeton n'est pas configuré.
    return res.status(503).json({ error: 'API_TOKEN non configuré côté serveur' });
  }
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const provided = match ? match[1].trim() : '';
  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  return next();
}
