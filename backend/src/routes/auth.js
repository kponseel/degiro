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
  isAdminUser,
  createExtensionToken,
  listExtensionTokens,
  revokeExtensionToken,
} from '../services/auth.js';
import { requireSession, sessionToken, sessionCookieOptions } from '../middleware/session.js';

const router = Router();

/**
 * Base des liens de connexion.
 *
 * `req.get('host')` est fourni par le CLIENT : s'en servir hors développement
 * permettrait à un attaquant de déclencher l'envoi, à l'adresse de sa victime,
 * d'un lien valide pointant vers son propre domaine — et donc de récupérer le
 * jeton. APP_URL fait donc autorité en production (son absence est fatale au
 * démarrage, voir `checkConfig`), et la dérivation reste réservée au local.
 */
const requestBaseUrl = (req) => (
  config.auth.appUrl || (config.isDevOrTest ? `${req.protocol}://${req.get('host')}` : '')
);

// Limiteur strict sur l'envoi de liens (anti-abus / anti-spam). Neutralisé en test.
const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.VITEST === 'true',
});

// POST /api/auth/request-link — { email, pseudo? } → envoie un lien magique.
router.post('/request-link', linkLimiter, async (req, res, next) => {
  try {
    const { email, pseudo } = req.body || {};
    const result = await requestMagicLink({ email, pseudo, appUrl: requestBaseUrl(req) });
    if (result.error === 'invalid_email') return res.status(400).json({ error: 'Email invalide' });
    if (result.error === 'pseudo_taken') return res.status(409).json({ error: 'Ce pseudo est déjà pris — choisis-en un autre (ou laisse vide).' });
    if (result.error === 'not_allowed') return res.status(403).json({ error: "Les inscriptions sont réservées : demande au propriétaire d'ajouter ton adresse." });
    if (result.error === 'too_many_requests') return res.status(429).json({ error: 'Trop de demandes pour cette adresse. Réessaie dans un quart d\'heure.' });
    if (result.error === 'mail_not_configured') {
      return res.status(503).json({ error: "Connexion indisponible : l'envoi d'email n'est pas configuré sur le serveur (variables SMTP_*)." });
    }
    if (result.error === 'mail_failed') {
      return res.status(503).json({ error: "L'envoi du lien a échoué (serveur d'email injoignable). Réessaie dans quelques minutes." });
    }
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
    return res.json({ user: { ...result.user, isAdmin: isAdminUser(result.user) } });
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
  res.json({ user: { ...req.user, isAdmin: isAdminUser(req.user) } });
});

// PATCH /api/auth/me — modifie le pseudo (doit être libre).
router.patch('/me', requireSession, async (req, res, next) => {
  try {
    const result = await updatePseudo(req.user.id, req.body?.pseudo);
    if (result.error === 'invalid_pseudo') return res.status(400).json({ error: 'Pseudo invalide' });
    if (result.error === 'pseudo_taken') return res.status(409).json({ error: 'Ce pseudo est déjà pris' });
    const { user } = result;
    return res.json({ user: { id: user.id, email: user.email, pseudo: user.pseudo, isAdmin: isAdminUser(user) } });
  } catch (err) {
    return next(err);
  }
});

// GET /api/auth/me/tokens — mes jetons d'extension (sans le clair).
router.get('/me/tokens', requireSession, async (req, res, next) => {
  try {
    return res.json({ tokens: await listExtensionTokens(req.user.id) });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/me/tokens — crée un jeton. Le clair n'est renvoyé QU'ICI.
router.post('/me/tokens', requireSession, async (req, res, next) => {
  try {
    const result = await createExtensionToken(req.user.id, req.body?.label);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/auth/me/tokens/:id — révoque un jeton.
router.delete('/me/tokens/:id', requireSession, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Id invalide' });
    const ok = await revokeExtensionToken(req.user.id, id);
    if (!ok) return res.status(404).json({ error: 'Jeton introuvable' });
    return res.json({ ok: true });
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
