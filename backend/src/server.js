import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

const app = createApp();

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
