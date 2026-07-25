import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { getSessionUser, getExtensionTokenUser } from '../services/auth.js';
import { sessionToken } from './session.js';

/** Comparaison à temps constant de deux chaînes (protège des attaques temporelles). */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // comparaison factice, ne court-circuite pas sur la longueur
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Authentifie la requête et attache `req.user` ({ id, email, pseudo }).
 * Trois voies acceptées :
 *  1. Session (cookie httpOnly) → l'utilisateur connecté dans le navigateur.
 *  2. Jeton d'extension (Bearer dgx_…) → l'utilisateur qui l'a généré. Voie de
 *     l'extension Chrome, qui ne peut pas utiliser le cookie (requête
 *     cross-site depuis trader.degiro.nl, bloquée par SameSite=Lax).
 *  3. Jeton bearer historique (API_TOKEN) → le propriétaire (utilisateur #1),
 *     jeton de service pratique pour l'automatisation/scripts.
 * Sinon → 401.
 */
export async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(sessionToken(req));
    if (user) {
      req.user = user;
      return next();
    }

    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const provided = match ? match[1].trim() : '';

    if (provided) {
      const extUser = await getExtensionTokenUser(provided);
      if (extUser) {
        req.user = { ...extUser, viaExtension: true };
        return next();
      }
      const expected = config.apiToken;
      if (expected && safeEqual(provided, expected)) {
        req.user = { id: 1, email: config.auth.ownerEmail || null, pseudo: 'moi', viaToken: true };
        return next();
      }
    }

    return res.status(401).json({ error: 'Non authentifié' });
  } catch (err) {
    return next(err);
  }
}
