import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { resetDb } from './helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

const tokenFrom = (devLink) => new URL(devLink).searchParams.get('token');

async function register(email, pseudo) {
  const agent = request.agent(app);
  const link = await agent.post('/api/auth/request-link').send({ email, pseudo });
  await agent.post('/api/auth/verify').send({ token: tokenFrom(link.body.devLink) });
  return agent;
}

const snapshot = (captureId, isin, value) => ({
  source: 'extension',
  capture_id: captureId,
  captured_at: '2026-07-25T09:00:00Z',
  total_value_eur: value,
  positions: [{ isin, name: 'Titre', product_type: 'STOCK', value_eur: value }],
});

describe("Jetons d'extension", () => {
  it('génère un jeton, le renvoie en clair une seule fois, et le liste sans le clair', async () => {
    const agent = await register('alice@example.com', 'Alice');

    const created = await agent.post('/api/auth/me/tokens').send({ label: 'Chrome perso' });
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(/^dgx_/);
    expect(created.body.label).toBe('Chrome perso');

    const list = await agent.get('/api/auth/me/tokens');
    expect(list.body.tokens).toHaveLength(1);
    // Le clair ne doit JAMAIS ressortir d'une lecture.
    expect(JSON.stringify(list.body)).not.toContain(created.body.token);
    expect(list.body.tokens[0].prefix).toBe(created.body.token.slice(0, 8));
    expect(list.body.tokens[0].uses).toBe(0);
  });

  it("le jeton authentifie l'ingestion et compte les usages", async () => {
    const agent = await register('alice@example.com', 'Alice');
    const { body } = await agent.post('/api/auth/me/tokens').send({ label: 'Ext' });

    // Sans cookie, uniquement le jeton : c'est le cas réel de l'extension.
    const ingest = await request(app)
      .post('/api/ingest')
      .set({ Authorization: `Bearer ${body.token}` })
      .send(snapshot('ext-1', 'US67066G1040', 1500));
    expect(ingest.status).toBe(201);

    const port = await agent.get('/api/portfolio');
    expect(port.body.positions.map((p) => p.isin)).toEqual(['US67066G1040']);

    const list = await agent.get('/api/auth/me/tokens');
    expect(list.body.tokens[0].uses).toBeGreaterThanOrEqual(1);
    expect(list.body.tokens[0].last_used_at).toBeTruthy();
  });

  it("le jeton d'un utilisateur écrit chez LUI, pas chez un autre", async () => {
    const alice = await register('alice@example.com', 'Alice');
    const bob = await register('bob@example.com', 'Bob');
    const tokAlice = (await alice.post('/api/auth/me/tokens').send({ label: 'A' })).body.token;

    await request(app).post('/api/ingest').set({ Authorization: `Bearer ${tokAlice}` })
      .send(snapshot('cap-a', 'US67066G1040', 999));

    expect((await alice.get('/api/portfolio')).body.positions).toHaveLength(1);
    expect((await bob.get('/api/portfolio')).body.snapshot).toBeNull();
  });

  it('un jeton révoqué ne fonctionne plus', async () => {
    const agent = await register('alice@example.com', 'Alice');
    const { body } = await agent.post('/api/auth/me/tokens').send({ label: 'Ext' });
    const id = (await agent.get('/api/auth/me/tokens')).body.tokens[0].id;

    expect((await agent.delete(`/api/auth/me/tokens/${id}`)).status).toBe(200);

    const after = await request(app).post('/api/ingest')
      .set({ Authorization: `Bearer ${body.token}` })
      .send(snapshot('ext-2', 'US67066G1040', 1500));
    expect(after.status).toBe(401);
  });

  it('un jeton inventé ou tronqué est refusé', async () => {
    for (const bad of ['dgx_inexistant', 'dgx_', 'pas-un-jeton']) {
      const res = await request(app).get('/api/portfolio').set({ Authorization: `Bearer ${bad}` });
      expect(res.status).toBe(401);
    }
  });

  it('on ne peut pas révoquer le jeton de quelqu’un d’autre', async () => {
    const alice = await register('alice@example.com', 'Alice');
    const bob = await register('bob@example.com', 'Bob');
    await alice.post('/api/auth/me/tokens').send({ label: 'A' });
    const idAlice = (await alice.get('/api/auth/me/tokens')).body.tokens[0].id;

    expect((await bob.delete(`/api/auth/me/tokens/${idAlice}`)).status).toBe(404);
    expect((await alice.get('/api/auth/me/tokens')).body.tokens).toHaveLength(1);
  });

  it('la gestion des jetons exige une session (pas seulement un jeton)', async () => {
    const agent = await register('alice@example.com', 'Alice');
    const { body } = await agent.post('/api/auth/me/tokens').send({ label: 'Ext' });
    // Un jeton d'extension ne doit pas permettre d'en créer d'autres.
    const res = await request(app).post('/api/auth/me/tokens')
      .set({ Authorization: `Bearer ${body.token}` }).send({ label: 'Escalade' });
    expect(res.status).toBe(401);
  });

  it('la suppression du compte révoque ses jetons', async () => {
    const agent = await register('alice@example.com', 'Alice');
    const { body } = await agent.post('/api/auth/me/tokens').send({ label: 'Ext' });
    await agent.delete('/api/auth/me');

    const res = await request(app).get('/api/portfolio').set({ Authorization: `Bearer ${body.token}` });
    expect(res.status).toBe(401);
  });
});
