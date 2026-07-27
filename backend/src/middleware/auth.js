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

/**
 * Chemins (sous /api) qu'un jeton d'extension a le droit d'appeler.
 * L'extension ne fait qu'une chose : déposer une capture.
 */
const EXTENSION_ALLOWED = [/^\/ingest(\/|$)/];

/**
 * Restreint la portée du jeton d'extension.
 *
 * Ce jeton vit dans le stockage local d'une extension de navigateur : il est
 * bien plus exposé qu'un cookie de session. Or il ouvrait jusqu'ici la totalité
 * de l'API — y compris la suppression du compte et, pour un administrateur, la
 * gestion des inscrits. Le limiter à l'ingestion aligne son pouvoir sur son
 * usage réel, et transforme sa fuite en incident sans conséquence.
 *
 * À monter après `requireAuth`, sur le préfixe /api.
 */
export function restrictExtensionScope(req, res, next) {
  if (!req.user?.viaExtension) return next();
  if (EXTENSION_ALLOWED.some((re) => re.test(req.path))) return next();
  return res.status(403).json({
    error: "Ce jeton d'extension ne permet que l'envoi de captures. Connecte-toi pour le reste.",
  });
}
