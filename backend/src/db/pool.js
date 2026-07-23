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
    });
  }
  return pool;
}

/** Renvoie true si la base répond à un SELECT 1, false sinon (jamais throw). */
export async function pingDb() {
  try {
    const conn = await getPool().getConnection();
    try {
      await conn.query('SELECT 1');
      return true;
    } finally {
      conn.release();
    }
  } catch {
    return false;
  }
}

/** Ferme le pool (utile pour les tests et l'arrêt propre). */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
