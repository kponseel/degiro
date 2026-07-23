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

async function seedDividends() {
  const recent = `${new Date().toISOString().slice(0, 10)} 10:00:00`;
  await getPool().query(
    `INSERT INTO transactions (account_id, tx_date, type, isin, description, amount, currency, external_id)
     VALUES ?`,
    [
      [
        [1, recent, 'dividend', 'US67066G1040', 'Dividende', 12.5, 'USD', 't-div-1'],
        [1, recent, 'tax', 'US67066G1040', 'Impôt sur dividende', -1.88, 'USD', 't-tax-1'],
        [1, recent, 'dividend', 'IE00B4L5Y983', 'Dividende', 5.0, 'EUR', 't-div-2'],
      ],
    ],
  );
}

describe('GET /api/dividends', () => {
  it('agrège les dividendes 12 mois par devise (net = brut - retenue)', async () => {
    await seedDividends();
    const res = await request(app).get('/api/dividends').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);

    const usd = res.body.currencies.find((c) => c.currency === 'USD');
    expect(usd.gross).toBeCloseTo(12.5, 2);
    expect(usd.tax).toBeCloseTo(-1.88, 2);
    expect(usd.net).toBeCloseTo(10.62, 2);

    const eur = res.body.currencies.find((c) => c.currency === 'EUR');
    expect(eur.net).toBeCloseTo(5.0, 2);

    const nvda = res.body.payers.find((p) => p.isin === 'US67066G1040');
    expect(nvda.gross).toBeCloseTo(12.5, 2);
  });

  it('renvoie un résultat vide sans dividende', async () => {
    const res = await request(app).get('/api/dividends').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.currencies).toEqual([]);
  });

  it('exige une authentification', async () => {
    const res = await request(app).get('/api/dividends');
    expect(res.status).toBe(401);
  });
});
