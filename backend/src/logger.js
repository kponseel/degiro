import pino from 'pino';
import { config } from './config.js';

/**
 * Journal applicatif, avec occultation des porteurs d'identité.
 *
 * Masquer le jeton dans l'URL ne suffisait pas : la réponse de connexion pose le
 * cookie de session via `Set-Cookie`, et les requêtes suivantes le renvoient dans
 * `Cookie` — sérialisés tels quels, ces en-têtes faisaient de chaque ligne de
 * journal une session ouvrable par quiconque lit les fichiers de log. Même
 * raisonnement pour `Authorization`, qui porte le jeton d'extension.
 */
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'res.headers["set-cookie"]',
      'req.headers.cookie',
      'req.headers.authorization',
      'err.config.headers.authorization',
    ],
    censor: '[occulté]',
  },
});
