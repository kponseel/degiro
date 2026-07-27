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

/**
 * Migrations en arrière-plan (idempotentes), avec réessais.
 *
 * La base n'est pas toujours prête quand le process démarre — hébergement
 * mutualisé, redémarrage simultané, autorisation d'accès distante appliquée avec
 * quelques secondes de retard. Sans réessai, un seul échec au démarrage laissait
 * l'application debout sur un schéma vide, **définitivement** : les migrations
 * n'étaient jamais rejouées, et il fallait redéployer pour s'en sortir.
 */
async function prepareDatabase(attempt = 1) {
  const MAX = 5;
  try {
    await migrate();
    logger.info('Migrations vérifiées');
    await ensureOwner();
  } catch (err) {
    if (attempt >= MAX) {
      logger.error(`Démarrage base échoué après ${MAX} tentatives : ${err.message}. Vérifie les variables DB_* et l'autorisation d'accès distant, puis redémarre.`);
      return;
    }
    const delay = 5000 * 2 ** (attempt - 1); // 5 s, 10 s, 20 s, 40 s
    logger.warn(`Base indisponible (${err.message}) — nouvelle tentative dans ${delay / 1000} s (${attempt}/${MAX - 1}).`);
    setTimeout(() => { prepareDatabase(attempt + 1); }, delay).unref();
  }
}

prepareDatabase();

// Arrêt propre.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    logger.info(`${signal} reçu, arrêt du serveur`);
    server.close(() => process.exit(0));
  });
}
