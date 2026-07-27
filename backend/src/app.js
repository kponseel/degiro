import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import { requireAuth, restrictExtensionScope } from './middleware/auth.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import ingestRouter from './routes/ingest.js';
import ingestCsvRouter from './routes/ingestCsv.js';
import portfolioRouter from './routes/portfolio.js';
import snapshotsRouter from './routes/snapshots.js';
import exposureRouter from './routes/exposure.js';
import enrichRouter from './routes/enrich.js';
import isinRefRouter from './routes/isinRef.js';
import dividendsRouter from './routes/dividends.js';
import performanceRouter from './routes/performance.js';
import etfHoldingsRouter from './routes/etfHoldings.js';
import lookthroughRouter from './routes/lookthrough.js';
import benchmarkRouter from './routes/benchmark.js';
import adminRouter from './routes/admin.js';
import newsRouter from './routes/news.js';
import aiRouter from './routes/ai.js';
import extensionRouter from './routes/extension.js';
import analyticsRouter from './routes/analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../../frontend/dist');

/**
 * Masque les valeurs sensibles présentes dans une URL avant journalisation.
 * Le jeton du lien magique vaut une session : il n'a rien à faire dans un log.
 */
export function maskSecrets(url) {
  return String(url ?? '').replace(/([?&](?:token|sessionId)=)[^&#\s]+/gi, '$1***');
}

/**
 * Construit l'application Express (sans écouter de port) — testable via supertest.
 * En production, ce même process sert l'API sous /api ET le build React (single-process Hostinger).
 */
export function createApp() {
  const app = express();

  // Derrière le reverse proxy Hostinger : nécessaire pour lire l'IP réelle (rate-limit).
  app.set('trust proxy', 1);

  app.use(helmet());
  // Le front pèse 728 Ko d'assets bruts pour 194 Ko compressés : sans cela,
  // chaque première visite télécharge 530 Ko inutiles — sensible sur mobile.
  app.use(compression());
  app.use(pinoHttp({
    logger,
    // Le lien de connexion transporte son jeton dans l'URL (/auth/verify?token=…).
    // Journalisé tel quel, chaque ligne de log devient une session ouvrable par
    // quiconque lit les journaux : on masque avant écriture.
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: maskSecrets(req.url),
        remoteAddress: req.remoteAddress,
      }),
    },
  }));
  // L'ingestion par l'extension embarque l'historique complet des transactions :
  // une limite trop basse rejetterait les gros comptes (plusieurs années d'ordres).
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  // Rate limiting sur toute l'API.
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      // 300 était atteint par un simple usage soutenu (chaque page appelle
      // plusieurs routes) : le plafond sert à écarter les abus, pas les visiteurs.
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
      // Le gestionnaire par défaut répond en HTML anglais, alors que toute l'API
      // parle JSON français — l'interface affichait donc « Too many requests ».
      handler: (_req, res) => res.status(429).json({
        error: 'Trop de requêtes d’affilée. Patiente quelques minutes, puis réessaie.',
      }),
    }),
  );

  // Santé : publique (monitoring), avant l'authentification.
  app.use('/api/health', healthRouter);

  // Authentification (liens magiques + sessions) : publique, se protège elle-même.
  app.use('/api/auth', authRouter);

  // Téléchargement de l'extension : publique (code open-source, aucun secret),
  // pour que le lien fonctionne sans dépendre du cookie de session.
  app.use('/api/extension', extensionRouter);

  // Toutes les autres routes /api exigent le jeton bearer (migration vers sessions en cours).
  app.use('/api', requireAuth);
  // Le jeton d'extension ne vaut que pour l'ingestion (voir middleware/auth.js).
  app.use('/api', restrictExtensionScope);
  app.use('/api/ingest/csv', ingestCsvRouter);
  app.use('/api/ingest', ingestRouter);
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/snapshots', snapshotsRouter);
  app.use('/api/exposure', exposureRouter);
  app.use('/api/enrich', enrichRouter);
  app.use('/api/isin-ref', isinRefRouter);
  app.use('/api/dividends', dividendsRouter);
  app.use('/api/performance', performanceRouter);
  app.use('/api/etf-holdings', etfHoldingsRouter);
  app.use('/api/lookthrough', lookthroughRouter);
  app.use('/api/benchmark', benchmarkRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/news', newsRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/analytics', analyticsRouter);

  // Toute route /api inconnue → 404 JSON (avant le fallback SPA).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Frontend statique + fallback SPA (placés APRÈS les routes API).
  app.use(express.static(DIST_DIR));
  app.get('*', (_req, res, next) => {
    res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
      if (err) next();
    });
  });

  // Gestionnaire d'erreurs centralisé (JSON).
  //
  // Les messages d'erreur 4xx sont écrits pour l'utilisateur et lui sont rendus
  // tels quels. Au-delà, le message vient des couches basses (MySQL, fetch, …) et
  // décrit l'intérieur du système — noms de tables, hôtes, chemins : il reste dans
  // les journaux, le client reçoit un message neutre.
  app.use((err, req, res, _next) => {
    req.log?.error(err);
    const status = err.status || err.statusCode || 500;
    const exposed = status < 500 && err.message ? err.message : 'Erreur interne du serveur';
    res.status(status).json({ error: exposed });
  });

  return app;
}
