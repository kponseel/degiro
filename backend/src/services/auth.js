import { randomBytes, createHash } from 'node:crypto';
import { getPool } from '../db/pool.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { sendMagicLink } from './mailer.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const randomToken = () => randomBytes(32).toString('base64url');
const hashToken = (raw) => createHash('sha256').update(String(raw)).digest('hex');
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const plusSql = (ms) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
export const cleanPseudo = (p) => String(p || '').trim().replace(/\s+/g, ' ').slice(0, 60);

export function isValidEmail(email) {
  const e = normalizeEmail(email);
  return e.length <= 255 && EMAIL_RE.test(e);
}

async function findUserByEmail(email) {
  const [rows] = await getPool().query('SELECT id, email, pseudo FROM users WHERE email = ? LIMIT 1', [email]);
  return rows[0] || null;
}

/**
 * Crée un utilisateur en protégeant l'id 1, réservé au propriétaire :
 * l'id 1 porte les données historiques (account_id = 1) et ne doit JAMAIS
 * échoir à un inscrit par simple ordre d'arrivée.
 *  - email == OWNER_EMAIL → tente de réclamer l'id 1 (s'il est libre).
 *  - sinon insertion normale ; si l'auto-incrément attribue quand même 1
 *    (table neuve, migration 005 pas encore passée), on répare et on réessaie.
 */
async function createUser(email, pseudo) {
  const pool = getPool();
  const isOwner = Boolean(config.auth.ownerEmail) && email === config.auth.ownerEmail;
  if (isOwner) {
    try {
      await pool.query(
        'INSERT INTO users (id, email, pseudo, created_at, last_login_at) VALUES (1, ?, ?, NOW(), NOW())',
        [email, pseudo],
      );
      logger.info(`Propriétaire connecté pour la première fois → utilisateur #1 (${email})`);
      return { id: 1, email, pseudo };
    } catch {
      // id 1 déjà occupé (ensureOwner l'a créé, ou situation anormale déjà signalée au boot).
    }
  }
  let [ins] = await pool.query(
    'INSERT INTO users (email, pseudo, created_at, last_login_at) VALUES (?, ?, NOW(), NOW())',
    [email, pseudo],
  );
  if (ins.insertId === 1 && !isOwner) {
    logger.warn(`Garde-fou : inscription ${email} a reçu l'id 1 (réservé au propriétaire) — réattribution`);
    await pool.query('DELETE FROM users WHERE id = 1');
    await pool.query('ALTER TABLE users AUTO_INCREMENT = 2');
    [ins] = await pool.query(
      'INSERT INTO users (email, pseudo, created_at, last_login_at) VALUES (?, ?, NOW(), NOW())',
      [email, pseudo],
    );
  }
  return { id: ins.insertId, email, pseudo };
}

export async function getUserById(id) {
  const [rows] = await getPool().query('SELECT id, email, pseudo, created_at, last_login_at FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

/** Purge opportuniste : liens expirés/consommés depuis > 1 jour, sessions expirées. */
async function purgeStale() {
  const pool = getPool();
  await pool.query('DELETE FROM magic_links WHERE expires_at < NOW() - INTERVAL 1 DAY');
  await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
}

/**
 * Demande un lien magique.
 *  - email connu → on envoie le lien (le pseudo fourni est ignoré).
 *  - email inconnu + pseudo → l'utilisateur sera créé à la vérification.
 *  - email inconnu sans pseudo → { needPseudo: true } (rien n'est envoyé).
 * @returns {Promise<{ sent:boolean, needPseudo?:boolean, devLink?:string }>}
 */
export async function requestMagicLink({ email, pseudo, appUrl }) {
  const mail = normalizeEmail(email);
  if (!isValidEmail(mail)) return { sent: false, error: 'invalid_email' };
  await purgeStale().catch(() => {});

  const existing = await findUserByEmail(mail);
  const wantedPseudo = cleanPseudo(pseudo);
  if (!existing && !wantedPseudo) {
    return { sent: false, needPseudo: true };
  }

  const raw = randomToken();
  await getPool().query(
    'INSERT INTO magic_links (email, pseudo, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    [mail, existing ? null : wantedPseudo, hashToken(raw), plusSql(config.auth.magicTtlMin * 60 * 1000), nowSql()],
  );

  const base = (appUrl || config.auth.appUrl || '').replace(/\/+$/, '');
  const link = `${base}/auth/verify?token=${raw}`;
  const { mode } = await sendMagicLink(mail, link, existing ? existing.pseudo : wantedPseudo);

  // Le lien n'est exposé qu'en mode dev (pas de serveur mail configuré).
  return { sent: true, ...(mode === 'dev' ? { devLink: link } : {}) };
}

/**
 * Vérifie un jeton de lien magique : consomme le code (usage unique), crée ou
 * met à jour l'utilisateur, ouvre une session.
 * @returns {Promise<{ user:object, sessionToken:string, maxAgeMs:number }|null>}
 */
export async function verifyMagicLink(rawToken) {
  const pool = getPool();
  const [links] = await pool.query(
    'SELECT id, email, pseudo FROM magic_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1',
    [hashToken(rawToken)],
  );
  if (!links.length) return null;
  const link = links[0];

  // Consommation atomique : si 0 ligne affectée, le code a été utilisé entre-temps.
  const [consumed] = await pool.query('UPDATE magic_links SET used_at = NOW() WHERE id = ? AND used_at IS NULL', [link.id]);
  if (!consumed.affectedRows) return null;

  let user = await findUserByEmail(link.email);
  if (!user) {
    const pseudo = cleanPseudo(link.pseudo) || link.email.split('@')[0].slice(0, 60);
    user = await createUser(link.email, pseudo);
  } else {
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  }

  const maxAgeMs = config.auth.sessionTtlDays * 24 * 60 * 60 * 1000;
  const sessionToken = randomToken();
  await pool.query(
    'INSERT INTO sessions (user_id, token_hash, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)',
    [user.id, hashToken(sessionToken), nowSql(), plusSql(maxAgeMs), nowSql()],
  );

  return { user: { id: user.id, email: user.email, pseudo: user.pseudo }, sessionToken, maxAgeMs };
}

/** Résout l'utilisateur d'une session (jeton de cookie). Rafraîchit last_seen. */
export async function getSessionUser(rawSessionToken) {
  if (!rawSessionToken) return null;
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.pseudo
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW() LIMIT 1`,
    [hashToken(rawSessionToken)],
  );
  if (!rows.length) return null;
  await pool.query('UPDATE sessions SET last_seen = NOW() WHERE token_hash = ?', [hashToken(rawSessionToken)]);
  return rows[0];
}

export async function destroySession(rawSessionToken) {
  if (!rawSessionToken) return;
  await getPool().query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(rawSessionToken)]);
}

export async function updatePseudo(userId, pseudo) {
  const clean = cleanPseudo(pseudo);
  if (!clean) return null;
  await getPool().query('UPDATE users SET pseudo = ? WHERE id = ?', [clean, userId]);
  return getUserById(userId);
}

/** Supprime toutes les données de portefeuille d'un utilisateur (positions en cascade). */
export async function deleteUserData(userId) {
  const pool = getPool();
  await pool.query('DELETE FROM transactions WHERE account_id = ?', [userId]);
  await pool.query('DELETE FROM snapshots WHERE account_id = ?', [userId]); // positions ON DELETE CASCADE
}

/** Supprime le compte : données + sessions + liens magiques en attente + ligne user. */
export async function deleteAccount(userId) {
  await deleteUserData(userId);
  const pool = getPool();
  const [rows] = await pool.query('SELECT email FROM users WHERE id = ?', [userId]);
  if (rows.length) {
    // Sans cette purge, un lien magique encore valide recréerait le compte supprimé.
    await pool.query('DELETE FROM magic_links WHERE email = ?', [rows[0].email]);
  }
  await pool.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
  await pool.query('DELETE FROM users WHERE id = ?', [userId]);
}

/**
 * Bootstrap propriétaire : si OWNER_EMAIL est défini et qu'aucun utilisateur #1
 * n'existe, crée l'utilisateur #1 avec cet email — il hérite des données
 * historiques (account_id = 1). Idempotent, appelé au démarrage.
 */
export async function ensureOwner() {
  const pool = getPool();
  const email = config.auth.ownerEmail;

  if (!email) {
    // Sans OWNER_EMAIL, personne ne peut réclamer les données historiques (account 1) :
    // on prévient si elles existent, pour aider au diagnostic.
    const [legacy] = await pool.query(
      'SELECT 1 FROM snapshots WHERE account_id = 1 LIMIT 1',
    );
    const [u1] = await pool.query('SELECT 1 FROM users WHERE id = 1 LIMIT 1');
    if (legacy.length && !u1.length) {
      logger.warn(
        "Des données existent pour le compte 1 mais OWNER_EMAIL n'est pas défini : " +
          'définissez OWNER_EMAIL pour que le propriétaire les récupère à sa connexion.',
      );
    }
    return;
  }

  const [rows] = await pool.query('SELECT id, email FROM users WHERE id = 1 OR email = ? LIMIT 2', [email]);
  const idOne = rows.find((r) => r.id === 1);
  const byEmail = rows.find((r) => r.email === email);
  if (idOne && idOne.email !== email) {
    logger.warn(
      `L'utilisateur #1 (${idOne.email}) ne correspond pas à OWNER_EMAIL (${email}) — ` +
        'les données historiques appartiennent à cet utilisateur #1.',
    );
    return;
  }
  if (byEmail && byEmail.id !== 1) {
    logger.warn(
      `OWNER_EMAIL (${email}) existe déjà comme utilisateur #${byEmail.id} : il ne peut plus ` +
        "récupérer l'id 1 automatiquement.",
    );
    return;
  }
  if (idOne) return; // déjà en place

  try {
    await pool.query(
      "INSERT INTO users (id, email, pseudo, created_at) VALUES (1, ?, 'moi', NOW())",
      [email],
    );
    logger.info(`Propriétaire initialisé (utilisateur #1) : ${email}`);
  } catch (err) {
    logger.warn(`ensureOwner ignoré : ${err.message}`);
  }
}
