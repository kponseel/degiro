import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import { AUTH, resetDb } from './helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

function snap(capture_id, captured_at, total_value_eur) {
  return request(app).post('/api/ingest').set(AUTH).send({ source: 'extension', capture_id, captured_at, total_value_eur, positions: [] });
}

// Insère un cours de clôture par jour de [from..to] (linéaire close0 → close1),
// suffisamment de points pour que le service serve le cache SANS appel réseau
// (déterministe quel que soit l'accès Internet de l'environnement de test).
async function seedPrices(series, from, to, close0, close1) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days = Math.round((end - start) / 86400000);
  const rows = [];
  for (let i = 0; i <= days; i += 1) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    const close = close0 + ((close1 - close0) * i) / days;
    rows.push([series, d, close]);
  }
  await getPool().query(
    'INSERT INTO market_prices (series, price_date, close) VALUES ?',
    [rows],
  );
}

describe('GET /api/benchmark', () => {
  it('historique insuffisant → available:false, mais expose la liste des benchmarks', async () => {
    await snap('b1', '2026-01-01T12:00:00Z', 10000);
    const res = await request(app).get('/api/benchmark').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('insufficient_history');
    expect(res.body.benchmarks.map((b) => b.key)).toContain('world');
    expect(res.body.benchmarks.map((b) => b.key)).toContain('sp500');
  });

  it('compare le TWR au benchmark depuis les cours en cache (alpha)', async () => {
    await snap('b1', '2026-01-01T12:00:00Z', 10000);
    await snap('b2', '2026-02-01T12:00:00Z', 11000); // portefeuille +10 %
    await seedPrices('world', '2026-01-01', '2026-02-01', 100, 110); // benchmark +10 %

    const res = await request(app).get('/api/benchmark?symbol=world').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.symbol).toBe('world');
    expect(res.body.twr).toBeCloseTo(0.1, 4);
    expect(res.body.benchmarkReturn).toBeCloseTo(0.1, 3);
    expect(res.body.alpha).toBeCloseTo(0, 3);

    expect(res.body.series).toHaveLength(2);
    expect(res.body.series[0].benchmark).toBeCloseTo(0, 4); // normalisé à 0 au départ
    expect(res.body.series[1].benchmark).toBeCloseTo(0.1, 3);
  });

  it('surperformance positive quand le portefeuille bat le benchmark', async () => {
    await snap('b1', '2026-01-01T12:00:00Z', 10000);
    await snap('b2', '2026-02-01T12:00:00Z', 12000); // +20 %
    await seedPrices('sp500', '2026-01-01', '2026-02-01', 100, 105); // +5 %

    const res = await request(app).get('/api/benchmark?symbol=sp500').set(AUTH);
    expect(res.body.available).toBe(true);
    expect(res.body.alpha).toBeCloseTo(0.15, 2); // 20 % − 5 %
  });

  it('exige une authentification', async () => {
    const res = await request(app).get('/api/benchmark');
    expect(res.status).toBe(401);
  });
});
