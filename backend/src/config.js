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
  // Jeton bearer historique (mono-utilisateur). Conservé pour compat/scripts.
  apiToken: process.env.API_TOKEN || '',
  auth: {
    // Bootstrap : cet email devient l'utilisateur #1 (récupère les données existantes).
    ownerEmail: (process.env.OWNER_EMAIL || '').trim().toLowerCase(),
    // Administration (gestion des inscrits). À défaut, l'admin est le propriétaire.
    adminEmail: (process.env.ADMIN_EMAIL || process.env.OWNER_EMAIL || '').trim().toLowerCase(),
    // Base des liens magiques ; à défaut, dérivée de l'origine de la requête.
    appUrl: (process.env.APP_URL || '').replace(/\/+$/, ''),
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS) || 30,
    magicTtlMin: Number(process.env.MAGIC_LINK_TTL_MIN) || 15,
    cookieName: process.env.SESSION_COOKIE_NAME || 'degiro_session',
    // Cookie Secure en production (Hostinger sert en HTTPS).
    secureCookie: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1',
  },
  mail: {
    from: process.env.MAIL_FROM || 'DEGIRO Analyzer <noreply@localhost>',
    smtp: {
      host: (process.env.SMTP_HOST || '').trim(),
      port: Number(process.env.SMTP_PORT) || 587,
      user: (process.env.SMTP_USER || '').trim(),
      pass: process.env.SMTP_PASS || '',
    },
  },
};
