import mysql from 'mysql2/promise';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

/**
 * Applique les migrations SQL non encore jouées, dans l'ordre alphabétique des fichiers.
 * Idempotent : chaque fichier appliqué est enregistré dans schema_migrations.
 * Utilise une connexion dédiée avec multipleStatements (isolée du pool applicatif).
 */
export async function migrate() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const [rows] = await conn.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        logger.debug(`migration déjà appliquée : ${file}`);
        continue;
      }
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await conn.query('START TRANSACTION');
      try {
        await conn.query(sql);
        await conn.query('INSERT INTO schema_migrations (name, applied_at) VALUES (?, NOW())', [file]);
        await conn.query('COMMIT');
        logger.info(`migration appliquée : ${file}`);
        count += 1;
      } catch (err) {
        await conn.query('ROLLBACK');
        logger.error(`échec de la migration ${file} : ${err.message}`);
        throw err;
      }
    }
    logger.info(count === 0 ? 'aucune migration à appliquer' : `${count} migration(s) appliquée(s)`);
    return count;
  } finally {
    await conn.end();
  }
}

// Exécution directe en CLI : `node src/db/migrate.js`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(err);
      process.exit(1);
    });
}
