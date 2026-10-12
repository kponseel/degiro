import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import { AUTH, resetDb, snapshotPayload } from './helpers.js';

const app = createApp();
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closePool(); });

const ingest = (overrides) => request(app).post('/api/ingest').set(AUTH).send(snapshotPayload(overrides));

describe('GET /api/portfolio — capture précédente', () => {
  it('aucune capture antérieure : previous = null', async () => {
    await ingest();
    const { body } = await request(app).get('/api/portfolio').set(AUTH);
    expect(body.previous).toBeNull();
  });

  it('renvoie la capture précédente de la même source, avec ses positions', async () => {
    await ingest({ capture_id: 'j1', captured_at: '2026-07-18T10:00:00Z', total_value_eur: 11000 });
    await ingest({ capture_id: 'j2', captured_at: '2026-07-20T10:00:00Z', total_value_eur: 12000 });
    const { body } = await request(app).get('/api/portfolio').set(AUTH);
    expect(body.snapshot.snapshot_date).toBe('2026-07-20');
    expect(body.previous.snapshot.snapshot_date).toBe('2026-07-18');
    expect(Number(body.previous.snapshot.total_value_eur)).toBe(11000);
    expect(body.previous.positions.map((p) => p.isin)).toContain('US67066G1040');
    expect(body.previous.positions[0].name).toBeTruthy();
  });

  it('ignore une capture précédente d’une autre source', async () => {
    await ingest({ source: 'csv', capture_id: 'c1', captured_at: '2026-07-18T10:00:00Z' });
    await ingest({ capture_id: 'e2', captured_at: '2026-07-20T10:00:00Z' });
    const { body } = await request(app).get('/api/portfolio').set(AUTH);
    expect(body.previous).toBeNull();
  });

  it('versements nets conservés à la capture', async () => {
    await ingest({ net_deposits_eur: 9000, today_flow_eur: 0 });
    const [[row]] = await getPool().query('SELECT net_deposits_eur, today_flow_eur FROM snapshots');
    expect(Number(row.net_deposits_eur)).toBe(9000);
    expect(Number(row.today_flow_eur)).toBe(0);
    const pf = await request(app).get('/api/portfolio').set(AUTH);
    expect(Number(pf.body.snapshot.net_deposits_eur)).toBe(9000);
  });
});

describe('PUT /api/portfolio/notes/:isin', () => {
  it('enregistre, renvoie avec la position, puis supprime une note vidée', async () => {
    await ingest();
    const put = await request(app).put('/api/portfolio/notes/US67066G1040').set(AUTH)
      .send({ thesis: '  Leader des GPU  ', target_weight: 12.5 });
    expect(put.status).toBe(200);
    let { body } = await request(app).get('/api/portfolio').set(AUTH);
    const nvda = body.positions.find((p) => p.isin === 'US67066G1040');
    expect(nvda.note_thesis).toBe('Leader des GPU');
    expect(Number(nvda.note_target_weight)).toBe(12.5);

    await request(app).put('/api/portfolio/notes/US67066G1040').set(AUTH).send({ thesis: '', target_weight: null });
    ({ body } = await request(app).get('/api/portfolio').set(AUTH));
    expect(body.positions.find((p) => p.isin === 'US67066G1040').note_thesis).toBeNull();
    const [[{ n }]] = await getPool().query('SELECT COUNT(*) AS n FROM position_notes');
    expect(Number(n)).toBe(0);
  });

  it('refuse un ISIN ou un poids invalide', async () => {
    expect((await request(app).put('/api/portfolio/notes/PASUNISIN').set(AUTH).send({ thesis: 'x' })).status).toBe(400);
    expect((await request(app).put('/api/portfolio/notes/US67066G1040').set(AUTH).send({ target_weight: 140 })).status).toBe(400);
    expect((await request(app).put('/api/portfolio/notes/US67066G1040').set(AUTH).send({ thesis: 'x'.repeat(601) })).status).toBe(400);
  });

  it('exige une authentification', async () => {
    expect((await request(app).put('/api/portfolio/notes/US67066G1040').send({ thesis: 'x' })).status).toBe(401);
  });
});
