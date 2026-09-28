import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import { AUTH, resetDb, snapshotPayload } from './helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe('POST /api/ingest', () => {
  it('crée un snapshot (201) et le renvoie via /api/portfolio', async () => {
    const res = await request(app).post('/api/ingest').set(AUTH).send(snapshotPayload());
    expect(res.status).toBe(201);
    expect(res.body.snapshotId).toBeGreaterThan(0);
    expect(res.body.deduplicated).toBe(false);

    const pf = await request(app).get('/api/portfolio').set(AUTH);
    expect(pf.status).toBe(200);
    expect(pf.body.positions).toHaveLength(2);
    // Tri par valeur décroissante : IWDA (9500) avant NVDA (1050).
    expect(pf.body.positions[0].symbol).toBe('IWDA');
    expect(Number(pf.body.snapshot.total_value_eur)).toBe(12000);
  });

  it('est idempotent : même capture_id → 200, même snapshot, pas de doublon', async () => {
    const first = await request(app).post('/api/ingest').set(AUTH).send(snapshotPayload());
    const again = await request(app).post('/api/ingest').set(AUTH).send(snapshotPayload());
    expect(again.status).toBe(200);
    expect(again.body.deduplicated).toBe(true);
    expect(again.body.snapshotId).toBe(first.body.snapshotId);

    const [snaps] = await getPool().query('SELECT id FROM snapshots');
    expect(snaps).toHaveLength(1);
  });

  it('remplace le snapshot du jour pour une même source (capture_id différent)', async () => {
    await request(app).post('/api/ingest').set(AUTH).send(snapshotPayload());
    const replaced = await request(app)
      .post('/api/ingest')
      .set(AUTH)
      .send(
        snapshotPayload({
          capture_id: 'cap-0002',
          captured_at: '2026-07-20T16:30:00Z',
          total_value_eur: 13000,
          positions: [
            { isin: 'US67066G1040', symbol: 'NVDA', product_type: 'STOCK', qty: 12, value_eur: 1300 },
          ],
        }),
      );
    expect(replaced.status).toBe(201);
    expect(replaced.body.replaced).toBe(true);

    const [snaps] = await getPool().query('SELECT total_value_eur FROM snapshots');
    expect(snaps).toHaveLength(1);
    expect(Number(snaps[0].total_value_eur)).toBe(13000);

    const pf = await request(app).get('/api/portfolio').set(AUTH);
    expect(pf.body.positions).toHaveLength(1);
  });

  it('rejette (400) un payload invalide', async () => {
    const res = await request(app)
      .post('/api/ingest')
      .set(AUTH)
      .send({ source: 'inconnu', capture_id: 'x', captured_at: '2026-07-20T10:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Payload invalide');
  });

  it('refuse (401) sans authentification', async () => {
    const res = await request(app).post('/api/ingest').send(snapshotPayload());
    expect(res.status).toBe(401);
  });
});
