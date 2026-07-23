import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import {
  requestMagicLink,
  verifyMagicLink,
  destroySession,
  updatePseudo,
  deleteUserData,
  deleteAccount,
} from '../services/auth.js';
import { requireSession, sessionToken, sessionCookieOptions } from '../middleware/session.js';

const router = Router();

// Base des liens dérivée de la requête si APP_URL n'est pas fixé (dev/local).
const requestBaseUrl = (req) => config.auth.appUrl || `${req.protocol}://${req.get('host')}`;

// Limiteur strict sur l'envoi de liens (anti-abus / anti-spam).
const linkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false });

// POST /api/auth/request-link — { email, pseudo? } → envoie un lien magique.
router.post('/request-link', linkLimiter, async (req, res, next) => {
  try {
    const { email, pseudo } = req.body || {};
    const result = await requestMagicLink({ email, pseudo, appUrl: requestBaseUrl(req) });
    if (result.error === 'invalid_email') return res.status(400).json({ error: 'Email invalide' });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/verify — { token } → ouvre une session (cookie httpOnly).
router.post('/verify', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Jeton manquant' });
    const result = await verifyMagicLink(token);
    if (!result) return res.status(401).json({ error: 'Lien invalide ou expiré' });
    res.cookie(config.auth.cookieName, result.sessionToken, sessionCookieOptions(result.maxAgeMs));
    return res.json({ user: result.user });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/logout — détruit la session courante.
router.post('/logout', async (req, res, next) => {
  try {
    await destroySession(sessionToken(req));
    res.clearCookie(config.auth.cookieName, sessionCookieOptions());
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// GET /api/auth/me — utilisateur courant.
router.get('/me', requireSession, (req, res) => {
  res.json({ user: req.user });
});

// PATCH /api/auth/me — modifie le pseudo.
router.patch('/me', requireSession, async (req, res, next) => {
  try {
    const user = await updatePseudo(req.user.id, req.body?.pseudo);
    if (!user) return res.status(400).json({ error: 'Pseudo invalide' });
    return res.json({ user: { id: user.id, email: user.email, pseudo: user.pseudo } });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/auth/me/data — efface mes données de portefeuille (garde le compte).
router.delete('/me/data', requireSession, async (req, res, next) => {
  try {
    await deleteUserData(req.user.id);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/auth/me — supprime le compte et déconnecte.
router.delete('/me', requireSession, async (req, res, next) => {
  try {
    await deleteAccount(req.user.id);
    res.clearCookie(config.auth.cookieName, sessionCookieOptions());
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
