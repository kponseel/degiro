import { createApp } from './app.js';
import { config, checkConfig } from './config.js';
import { logger } from './logger.js';
import { migrate } from './db/migrate.js';
import { ensureOwner } from './services/auth.js';

// Contrôle de configuration AVANT d'ouvrir le port. Une erreur fatale arrête le
// démarrage : mieux vaut un déploiement qui refuse de partir, avec un message
// explicite, qu'un site en ligne dont l'authentification est contournable.
const { fatal, warnings } = checkConfig();
for (const w of warnings) logger.warn(`Configuration : ${w}`);
if (fatal.length) {
  for (const f of fatal) logger.error(`Configuration : ${f}`);
  logger.error('Démarrage interrompu : corrige les variables d\'environnement ci-dessus puis relance.');
  process.exit(1);
}

const app = createApp();

// Le serveur écoute IMMÉDIATEMENT : on ne bloque jamais le démarrage sur la base
// (sinon une base injoignable ferait un 503, faute de port ouvert).
const server = app.listen(config.port, () => {
  logger.info(`DEGIRO Analyzer — API à l'écoute sur le port ${config.port}`);
});

// Sans ce gestionnaire, un port déjà occupé fait remonter un « Unhandled error
// event » et une trace de pile : au redémarrage d'un déploiement, le message
// utile est noyé. On dit ce qui se passe, puis on sort proprement.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${config.port} déjà utilisé : arrêter l'autre process ou changer PORT.`);
  } else {
    logger.error(`Impossible d'ouvrir le port ${config.port} : ${err.message}`);
  }
  process.exit(1);
});

// Migrations en arrière-plan (idempotent). En cas d'échec, l'app reste debout et
// GET /api/health signale « db: down » pour faciliter le diagnostic.
migrate()
  .then(() => logger.info('Migrations vérifiées'))
  .then(() => ensureOwner())
  .catch((err) => logger.error(`Démarrage base échoué : ${err.message}`));

// Arrêt propre.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    logger.info(`${signal} reçu, arrêt du serveur`);
    server.close(() => process.exit(0));
  });
}
