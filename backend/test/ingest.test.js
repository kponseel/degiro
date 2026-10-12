import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import { AUTH, resetDb, snapshotPayload } from './helpers.js';
import { isSuspectDrop } from '../src/services/plausibility.js';

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

// Une capture DEGIRO tronquée (7 lignes au lieu de 22, liquidités fausses)
// remplaçait la bonne capture du jour : la carte « Depuis ta capture » annonçait
// alors −89 %. Elle est maintenant refusée, sauf envoi forcé.
describe('POST /api/ingest — garde-fou capture incomplète', () => {
  const lignes = (n, valeur = 4000) => Array.from({ length: n }, (_, i) => ({
    isin: `FR${String(i).padStart(10, '0')}`,
    name: `Titre ${i}`,
    qty: 10,
    value_eur: valeur,
  }));
  const complete = (o = {}) => snapshotPayload({
    capture_id: 'cap-ok', captured_at: '2026-10-01T09:00:00Z', total_value_eur: 90000, cash_eur: 2000, positions: lignes(22), ...o,
  });
  const tronquee = (o = {}) => snapshotPayload({
    capture_id: 'cap-ko', captured_at: '2026-10-12T09:00:00Z', total_value_eur: 9500, cash_eur: 1200, positions: lignes(7, 1200), ...o,
  });

  it('refuse (409) une capture qui perd la moitié des lignes ET de la valeur, sans rien enregistrer', async () => {
    await request(app).post('/api/ingest').set(AUTH).send(complete());
    const res = await request(app).post('/api/ingest').set(AUTH).send(tronquee());
    expect(res.status).toBe(409);
    expect(res.body.suspect).toMatchObject({ lines: 7, previousLines: 22, total: 9500, previousTotal: 90000, since: '2026-10-01' });
    const [snaps] = await getPool().query('SELECT capture_id FROM snapshots');
    expect(snaps.map((x) => x.capture_id)).toEqual(['cap-ok']);
  });

  it('ne remplace pas la bonne capture du même jour', async () => {
    await request(app).post('/api/ingest').set(AUTH).send(complete({ captured_at: '2026-10-12T08:00:00Z' }));
    const res = await request(app).post('/api/ingest').set(AUTH).send(tronquee());
    expect(res.status).toBe(409);
    const pf = await request(app).get('/api/portfolio').set(AUTH);
    expect(pf.body.positions).toHaveLength(22);
  });

  it("accepte l'envoi forcé par l'utilisateur", async () => {
    await request(app).post('/api/ingest').set(AUTH).send(complete());
    const res = await request(app).post('/api/ingest').set(AUTH).send(tronquee({ force: true }));
    expect(res.status).toBe(201);
  });

  it('laisse passer une vente de la moitié des lignes (total intact) et une capture ancienne', async () => {
    await request(app).post('/api/ingest').set(AUTH).send(complete());
    const vente = await request(app).post('/api/ingest').set(AUTH).send(tronquee({ total_value_eur: 88000, cash_eur: 79600 }));
    expect(vente.status).toBe(201);

    await resetDb();
    await request(app).post('/api/ingest').set(AUTH).send(complete({ captured_at: '2026-09-01T09:00:00Z' }));
    const tard = await request(app).post('/api/ingest').set(AUTH).send(tronquee());
    expect(tard.status).toBe(201);
  });

  it("ne s'applique pas aux imports CSV", async () => {
    await request(app).post('/api/ingest').set(AUTH).send(complete({ source: 'csv' }));
    const res = await request(app).post('/api/ingest').set(AUTH).send(tronquee({ source: 'csv' }));
    expect(res.status).toBe(201);
  });

  it('règle pure : petits portefeuilles et données manquantes ne sont jamais suspects', () => {
    expect(isSuspectDrop({ lines: 7, total: 9500 }, { lines: 22, total: 90000 })).toBe(true);
    expect(isSuspectDrop({ lines: 1, total: 100 }, { lines: 3, total: 10000 })).toBe(false);
    expect(isSuspectDrop({ lines: 7, total: 60000 }, { lines: 22, total: 90000 })).toBe(false);
    expect(isSuspectDrop({ lines: 20, total: 9000 }, { lines: 22, total: 90000 })).toBe(false);
    expect(isSuspectDrop({ lines: 7, total: null }, { lines: 22, total: 90000 })).toBe(false);
  });
});
