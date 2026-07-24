import { Router } from 'express';
import { isAdminUser } from '../services/auth.js';
import { listUsers, adminUpdateUser, adminDeleteUser } from '../services/admin.js';

const router = Router();

// Réservé à l'administrateur (ADMIN_EMAIL, à défaut OWNER_EMAIL).
// req.user est déjà posé par le garde global de /api.
router.use((req, res, next) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ error: 'Réservé à l’administrateur' });
  return next();
});

// GET /api/admin/users — inscrits, activité, volume de données.
router.get('/users', async (_req, res, next) => {
  try {
    return res.json({ users: await listUsers() });
  } catch (err) {
    return next(err);
  }
});

const ERROR_MESSAGES = {
  not_found: [404, 'Utilisateur introuvable'],
  invalid_email: [400, 'Email invalide'],
  email_taken: [409, 'Cet email est déjà utilisé'],
  invalid_pseudo: [400, 'Pseudo invalide'],
  pseudo_taken: [409, 'Ce pseudo est déjà pris'],
};

// PATCH /api/admin/users/:id — édite email et/ou pseudo.
router.patch('/users/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Id invalide' });
    const result = await adminUpdateUser(id, { email: req.body?.email, pseudo: req.body?.pseudo });
    if (result.error) {
      const [status, message] = ERROR_MESSAGES[result.error] || [400, result.error];
      return res.status(status).json({ error: message });
    }
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/admin/users/:id — supprime le compte (pas le sien : passer par Mon compte).
router.delete('/users/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Id invalide' });
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Impossible de supprimer son propre compte ici — utiliser Mon compte' });
    }
    const result = await adminDeleteUser(id);
    if (result.error) return res.status(404).json({ error: 'Utilisateur introuvable' });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
