import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { migrate } from './db/migrate.js';

const app = createApp();

// Le serveur écoute IMMÉDIATEMENT : on ne bloque jamais le démarrage sur la base
// (sinon une base injoignable ferait un 503, faute de port ouvert).
const server = app.listen(config.port, () => {
  logger.info(`DEGIRO Analyzer — API à l'écoute sur le port ${config.port}`);
});

// Migrations en arrière-plan (idempotent). En cas d'échec, l'app reste debout et
// GET /api/health signale « db: down » pour faciliter le diagnostic.
migrate()
  .then(() => logger.info('Migrations vérifiées'))
  .catch((err) => logger.error(`Migrations échouées : ${err.message}`));

// Arrêt propre.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    logger.info(`${signal} reçu, arrêt du serveur`);
    server.close(() => process.exit(0));
  });
}
