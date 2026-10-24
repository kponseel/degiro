import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { AUTH, resetDb } from './helpers.js';

const app = createApp();
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closePool(); });

// Synthétique : deux lignes, un taux USD.
const body = (o = {}) => ({
  fetched_at: '2026-10-24T08:00:00Z',
  series: [
    { isin: 'US67066G1040', currency: 'USD', daily: [['2026-10-22', 120], ['2026-10-23', 121.5]], weekly: [['2026-10-20', 119]] },
    { isin: 'FR0000121014', currency: 'EUR', daily: [['2026-10-23', 600]], weekly: [] },
  ],
  fx: [{ currency: 'USD', rates: [['2026-10-22', 1.08], ['2026-10-23', 1.09]] }],
  ...o,
});

describe('/api/prices', () => {
  it('enregistre puis relit l’historique et les taux', async () => {
    expect((await request(app).post('/api/prices').set(AUTH).send(body())).status).toBe(201);
    const { body: got } = await request(app).get('/api/prices').set(AUTH);
    expect(got.series).toHaveLength(2);
    const nvda = got.series.find((s) => s.isin === 'US67066G1040');
    expect(nvda.daily).toEqual([['2026-10-22', 120], ['2026-10-23', 121.5]]);
    expect(nvda.weekly).toEqual([['2026-10-20', 119]]);
    expect(got.fx.USD).toEqual([['2026-10-22', 1.08], ['2026-10-23', 1.09]]);
  });

  it('remplace la ligne à la capture suivante, sans doublon', async () => {
    await request(app).post('/api/prices').set(AUTH).send(body());
    await request(app).post('/api/prices').set(AUTH).send(body({
      series: [{ isin: 'US67066G1040', currency: 'USD', daily: [['2026-10-24', 130]], weekly: [] }],
      fx: [],
    }));
    const { body: got } = await request(app).get('/api/prices').set(AUTH);
    expect(got.series).toHaveLength(2);
    expect(got.series.find((s) => s.isin === 'US67066G1040').daily).toEqual([['2026-10-24', 130]]);
    expect(got.fx.USD).toHaveLength(2);
  });

  it('refuse un ISIN, une date ou un cours invalides', async () => {
    for (const series of [
      [{ isin: 'pas-un-isin', daily: [['2026-10-22', 1]] }],
      [{ isin: 'US67066G1040', daily: [['22/10/2026', 1]] }],
      [{ isin: 'US67066G1040', daily: [['2026-10-22', -5]] }],
    ]) {
      expect((await request(app).post('/api/prices').set(AUTH).send(body({ series }))).status).toBe(400);
    }
  });

  it('exige une authentification', async () => {
    expect((await request(app).get('/api/prices')).status).toBe(401);
  });
});
