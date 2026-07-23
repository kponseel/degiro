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

describe('GET /api/performance (TWR)', () => {
  it('insuffisant avec moins de 2 snapshots', async () => {
    await snap('p1', '2026-01-01T12:00:00Z', 10000);
    const res = await request(app).get('/api/performance').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.insufficient).toBe(true);
    expect(res.body.twr).toBeNull();
  });

  it('TWR = variation de valeur sans flux externe', async () => {
    await snap('p1', '2026-01-01T12:00:00Z', 10000);
    await snap('p2', '2026-02-01T12:00:00Z', 11000);
    const res = await request(app).get('/api/performance').set(AUTH);
    expect(res.body.twr).toBeCloseTo(0.1, 4); // +10 %
    expect(res.body.series).toHaveLength(2);
  });

  it('neutralise un dépôt (Dietz modifié)', async () => {
    await snap('p1', '2026-01-01T12:00:00Z', 10000);
    await snap('p2', '2026-02-01T12:00:00Z', 16000);
    // dépôt de 5000 € le 16/01 (pondération temporelle 16/31)
    await getPool().query(
      `INSERT INTO transactions (account_id, tx_date, type, amount, currency, amount_eur, external_id)
       VALUES (1, '2026-01-16 10:00:00', 'deposit', 5000, 'EUR', 5000, 'dep-1')`,
    );
    const res = await request(app).get('/api/performance').set(AUTH);
    // r = (16000-10000-5000) / (10000 + 5000*16/31) ≈ 0.0795
    expect(res.body.twr).toBeCloseTo(0.0795, 3);
    expect(res.body.flows).toBe(1);
  });

  it('exige une authentification', async () => {
    const res = await request(app).get('/api/performance');
    expect(res.status).toBe(401);
  });
});
