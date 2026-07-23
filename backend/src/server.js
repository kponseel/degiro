import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { migrate } from './db/migrate.js';

const app = createApp();

// Applique les migrations au démarrage (idempotent) — évite toute étape manuelle
// au déploiement. En cas d'échec (base injoignable), on démarre quand même :
// GET /api/health signalera « db: down » pour faciliter le diagnostic.
try {
  await migrate();
} catch (err) {
  logger.error(`Migrations au démarrage échouées : ${err.message}`);
}

const server = app.listen(config.port, () => {
  logger.info(`DEGIRO Analyzer — API à l'écoute sur le port ${config.port}`);
});

// Arrêt propre.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    logger.info(`${signal} reçu, arrêt du serveur`);
    server.close(() => process.exit(0));
  });
}
