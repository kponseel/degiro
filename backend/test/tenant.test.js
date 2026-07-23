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

function snapshotFor(captureId, isin, name, valueEur) {
  return {
    source: 'extension',
    capture_id: captureId,
    captured_at: '2026-07-20T10:00:00Z',
    total_value_eur: valueEur,
    positions: [{ isin, name, product_type: 'STOCK', value_eur: valueEur }],
  };
}

describe('Isolation multi-tenant', () => {
  it('chaque utilisateur ne voit que ses propres données', async () => {
    const alice = await register('alice@example.com', 'Alice');
    const bob = await register('bob@example.com', 'Bob');

    // Même capture_id volontairement → vérifie l'unicité PAR utilisateur (migration 004).
    await alice.post('/api/ingest').send(snapshotFor('cap-shared', 'US67066G1040', 'NVIDIA CORP', 1000));
    await bob.post('/api/ingest').send(snapshotFor('cap-shared', 'US0378331005', 'APPLE INC', 2000));

    const aPort = await alice.get('/api/portfolio');
    const bPort = await bob.get('/api/portfolio');

    expect(aPort.body.positions.map((p) => p.isin)).toEqual(['US67066G1040']);
    expect(aPort.body.snapshot.total_value_eur).toBe('1000.00');

    expect(bPort.body.positions.map((p) => p.isin)).toEqual(['US0378331005']);
    expect(bPort.body.snapshot.total_value_eur).toBe('2000.00');
  });

  it('les séries et l’exposition sont cloisonnées', async () => {
    const alice = await register('alice@example.com', 'Alice');
    const bob = await register('bob@example.com', 'Bob');

    await alice.post('/api/ingest').send(snapshotFor('a1', 'US67066G1040', 'NVIDIA CORP', 1000));
    // Bob n'a aucune donnée.
    const aExp = await alice.get('/api/exposure');
    const bExp = await bob.get('/api/exposure');
    const bSnaps = await bob.get('/api/snapshots');

    expect(aExp.body.currency.length).toBeGreaterThan(0);
    expect(bExp.body.currency).toEqual([]);
    expect(bSnaps.body.snapshots).toEqual([]);
  });

  it('le jeton bearer historique agit comme le propriétaire (utilisateur #1)', async () => {
    // Alice, première inscrite, est l'utilisateur #1.
    const alice = await register('alice@example.com', 'Alice');
    await alice.post('/api/ingest').send(snapshotFor('a1', 'US67066G1040', 'NVIDIA CORP', 1500));

    const viaToken = await request(app)
      .get('/api/portfolio')
      .set({ Authorization: 'Bearer test_token_0123456789' });
    expect(viaToken.status).toBe(200);
    expect(viaToken.body.positions.map((p) => p.isin)).toEqual(['US67066G1040']);
  });
});
