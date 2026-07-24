import { getPool } from '../db/pool.js';
import { isValidEmail, normalizeEmail, cleanPseudo, pseudoTaken, deleteAccount } from './auth.js';

/** Liste des inscrits avec activité et volume de données (pour l'administration). */
export async function listUsers() {
  const [rows] = await getPool().query(
    `SELECT u.id, u.email, u.pseudo, u.created_at, u.last_login_at, u.login_count,
            (SELECT COUNT(*) FROM snapshots s WHERE s.account_id = u.id)   AS snapshots,
            (SELECT COUNT(*) FROM transactions t WHERE t.account_id = u.id) AS transactions,
            (SELECT COUNT(*) FROM sessions se WHERE se.user_id = u.id AND se.expires_at > NOW()) AS active_sessions
     FROM users u
     ORDER BY u.id ASC`,
  );
  return rows;
}

/**
 * Édition d'un utilisateur par l'admin (email et/ou pseudo).
 * @returns {Promise<{ user?:object, error?:string }>}
 */
export async function adminUpdateUser(userId, { email, pseudo }) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT id FROM users WHERE id = ?', [userId]);
  if (!rows.length) return { error: 'not_found' };

  if (email !== undefined) {
    const mail = normalizeEmail(email);
    if (!isValidEmail(mail)) return { error: 'invalid_email' };
    const [dup] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1', [mail, userId]);
    if (dup.length) return { error: 'email_taken' };
    await pool.query('UPDATE users SET email = ? WHERE id = ?', [mail, userId]);
  }
  if (pseudo !== undefined) {
    const clean = cleanPseudo(pseudo);
    if (!clean) return { error: 'invalid_pseudo' };
    if (await pseudoTaken(clean, userId)) return { error: 'pseudo_taken' };
    await pool.query('UPDATE users SET pseudo = ? WHERE id = ?', [clean, userId]);
  }

  const [updated] = await pool.query(
    'SELECT id, email, pseudo, created_at, last_login_at, login_count FROM users WHERE id = ?',
    [userId],
  );
  return { user: updated[0] };
}

/** Suppression d'un compte par l'admin (données + sessions + liens + ligne user). */
export async function adminDeleteUser(userId) {
  const [rows] = await getPool().query('SELECT id FROM users WHERE id = ?', [userId]);
  if (!rows.length) return { error: 'not_found' };
  await deleteAccount(userId);
  return { ok: true };
}
