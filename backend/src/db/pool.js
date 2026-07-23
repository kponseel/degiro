import mysql from 'mysql2/promise';
import { config } from '../config.js';

let pool;

/** Pool MySQL partagé (créé à la première utilisation). */
export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 3000,
      namedPlaceholders: true,
      charset: 'utf8mb4',
      // DATE/DATETIME renvoyés en chaînes ('YYYY-MM-DD' / 'YYYY-MM-DD HH:MM:SS'),
      // pas en objets Date — évite tout décalage de fuseau au retour.
      dateStrings: true,
    });
  }
  return pool;
}

/**
 * Teste la base avec un SELECT 1 (ne throw jamais).
 * @returns {Promise<{ ok: boolean, code: string|null }>} code = code d'erreur mysql2
 *   (ECONNREFUSED, ER_ACCESS_DENIED_ERROR, ENOTFOUND, ETIMEDOUT, ER_BAD_DB_ERROR…).
 */
export async function pingDb() {
  try {
    const conn = await getPool().getConnection();
    try {
      await conn.query('SELECT 1');
      return { ok: true, code: null };
    } finally {
      conn.release();
    }
  } catch (err) {
    const info = { ok: false, code: err.code || err.message || 'UNKNOWN' };
    // Sur un refus d'accès, MySQL indique l'origine vue : "…'user'@'HOST'…".
    // On expose UNIQUEMENT ce host (pas l'utilisateur) pour savoir quoi autoriser.
    const m = err.sqlMessage && /@'([^']+)'/.exec(err.sqlMessage);
    if (m) info.deniedFrom = m[1];
    return info;
  }
}

/** Ferme le pool (utile pour les tests et l'arrêt propre). */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
