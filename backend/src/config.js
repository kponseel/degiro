import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Charge backend/.env quel que soit le répertoire d'exécution (les scripts npm
// tournent depuis la racine du monorepo). Sans effet en CI/prod où les variables
// d'environnement sont fournies par la plateforme (fichier absent = no-op).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const nodeEnv = (process.env.NODE_ENV || '').trim().toLowerCase();

/**
 * Mode « développement ou test », déterminé par une valeur EXPLICITE.
 *
 * Le sens de ce test n'est pas anodin : les protections étaient auparavant
 * conditionnées à `NODE_ENV === 'production'`, si bien qu'une variable oubliée
 * sur l'hébergeur — cas par défaut chez Hostinger — désactivait silencieusement
 * le cookie `Secure` ET faisait renvoyer le lien de connexion par l'API, soit une
 * prise de compte ouverte à quiconque connaît une adresse email.
 *
 * La logique est donc inversée : seul un environnement explicitement déclaré de
 * développement ou de test relâche quoi que ce soit. Une variable absente laisse
 * l'application dans son mode le plus strict.
 */
export const isDevOrTest = nodeEnv === 'development' || nodeEnv === 'test' || process.env.VITEST === 'true';

/** Configuration centralisée, lue depuis l'environnement. */
export const config = {
  port: Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',
  nodeEnv,
  isDevOrTest,
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
    // Liste blanche d'inscription (emails séparés par des virgules).
    // Vide = inscription ouverte, le comportement par défaut.
    allowedEmails: (process.env.ALLOWED_EMAILS || '')
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS) || 30,
    magicTtlMin: Number(process.env.MAGIC_LINK_TTL_MIN) || 15,
    cookieName: process.env.SESSION_COOKIE_NAME || 'degiro_session',
    // Cookie Secure par défaut ; seul un environnement de dev/test l'assouplit,
    // et COOKIE_SECURE=0/1 permet de forcer explicitement l'un ou l'autre.
    secureCookie: process.env.COOKIE_SECURE === '0' ? false
      : process.env.COOKIE_SECURE === '1' ? true
        : !isDevOrTest,
    // Renvoyer le lien de connexion dans la réponse HTTP est un contournement de
    // l'authentification : réservé au développement et aux tests, jamais ailleurs.
    devLoginLinks: isDevOrTest,
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

/**
 * Contrôle de cohérence de la configuration, joué au démarrage.
 *
 * Rendu sous forme de listes plutôt que journalisé ici : `logger` lit `config`,
 * l'importer créerait un cycle. C'est `server.js` qui décide quoi en faire.
 *
 * @returns {{ fatal: string[], warnings: string[] }}
 */
export function checkConfig(c = config) {
  const fatal = [];
  const warnings = [];

  if (!c.isDevOrTest) {
    // APP_URL est l'ancre anti-injection : sans elle, la base du lien magique se
    // déduirait de l'en-tête Host, que le client contrôle — un attaquant ferait
    // envoyer à sa victime un lien valide pointant vers son propre domaine.
    if (!c.auth.appUrl) {
      fatal.push('APP_URL est obligatoire hors développement (base des liens de connexion). Ex. : APP_URL=https://degiro.estim.pro');
    } else if (!/^https?:\/\/[^/]+$/i.test(c.auth.appUrl)) {
      fatal.push(`APP_URL doit être une origine complète sans chemin (reçu : « ${c.auth.appUrl} »). Ex. : https://degiro.estim.pro`);
    } else if (!/^https:\/\//i.test(c.auth.appUrl)) {
      warnings.push('APP_URL n\'est pas en HTTPS : les liens de connexion circuleront en clair.');
    }

    if (!c.mail.smtp.host || !c.mail.smtp.user || !c.mail.smtp.pass) {
      warnings.push('SMTP_* incomplet : aucun lien de connexion ne pourra être envoyé, personne ne pourra se connecter.');
    }
    if (!c.auth.ownerEmail) {
      warnings.push('OWNER_EMAIL vide : aucun compte propriétaire ne sera créé au démarrage.');
    }
    if (!c.auth.secureCookie) {
      warnings.push('COOKIE_SECURE=0 hors développement : le cookie de session circulera sans l\'attribut Secure.');
    }
  }

  if (c.db.password === '' && !c.isDevOrTest) {
    warnings.push('DB_PASSWORD vide : vérifier que la base n\'est pas exposée sans mot de passe.');
  }

  return { fatal, warnings };
}
