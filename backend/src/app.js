import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import { requireAuth } from './middleware/auth.js';
import healthRouter from './routes/health.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../../frontend/dist');

/**
 * Construit l'application Express (sans écouter de port) — testable via supertest.
 * En production, ce même process sert l'API sous /api ET le build React (single-process Hostinger).
 */
export function createApp() {
  const app = express();

  // Derrière le reverse proxy Hostinger : nécessaire pour lire l'IP réelle (rate-limit).
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));

  // Rate limiting sur toute l'API.
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // Santé : publique (monitoring), avant l'authentification.
  app.use('/api/health', healthRouter);

  // Toutes les autres routes /api exigent le jeton bearer.
  app.use('/api', requireAuth);
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
  app.use((err, req, res, _next) => {
    req.log?.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  });

  return app;
}
