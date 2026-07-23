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
import portfolioRouter from './routes/portfolio.js';
import snapshotsRouter from './routes/snapshots.js';

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
  app.use('/api/ingest', ingestRouter);
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/snapshots', snapshotsRouter);

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
