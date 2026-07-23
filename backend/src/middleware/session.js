import { config } from '../config.js';
import { getSessionUser } from '../services/auth.js';

/** Lit le jeton de session dans le cookie httpOnly. */
export function sessionToken(req) {
  return req.cookies?.[config.auth.cookieName] || '';
}

/** Options communes du cookie de session (httpOnly, Secure en prod, SameSite=Lax). */
export function sessionCookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: config.auth.secureCookie,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

/** Exige une session valide ; attache req.user. Sinon 401. */
export async function requireSession(req, res, next) {
  try {
    const user = await getSessionUser(sessionToken(req));
    if (!user) return res.status(401).json({ error: 'Non authentifié' });
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}
