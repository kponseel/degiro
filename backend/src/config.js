import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Charge backend/.env quel que soit le répertoire d'exécution (les scripts npm
// tournent depuis la racine du monorepo). Sans effet en CI/prod où les variables
// d'environnement sont fournies par la plateforme (fichier absent = no-op).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/** Configuration centralisée, lue depuis l'environnement. */
export const config = {
  port: Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'degiro_dev',
  },
  // Vérifié par le middleware d'auth (branché au M1).
  apiToken: process.env.API_TOKEN || '',
};
