import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import { config } from '../src/config.js';
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

  it("une inscription ne reçoit JAMAIS l'id 1 (réservé au propriétaire)", async () => {
    // Régression du bug « données par défaut » : sans OWNER_EMAIL, le premier
    // inscrit héritait de l'id 1 et donc des données historiques (account 1).
    const alice = await register('alice@example.com', 'Alice');
    const me = await alice.get('/api/auth/me');
    expect(me.body.user.id).toBeGreaterThanOrEqual(2);
  });

  it("un nouvel inscrit ne voit pas les données historiques du compte 1", async () => {
    // Données « legacy » (pré-auth) rattachées au compte 1, aucun utilisateur en base.
    await getPool().query(
      `INSERT INTO snapshots (account_id, captured_at, snapshot_date, source, capture_id, total_value_eur)
       VALUES (1, '2026-07-01 10:00:00', '2026-07-01', 'extension', 'legacy-1', 99999)`,
    );
    const fresh = await register('nouveau@example.com', 'Nouveau');
    const port = await fresh.get('/api/portfolio');
    expect(port.body.snapshot).toBeNull();
    expect(port.body.positions).toEqual([]);
  });

  it('le jeton bearer historique agit comme le propriétaire (#1), isolé des inscrits', async () => {
    const alice = await register('alice@example.com', 'Alice');
    await alice.post('/api/ingest').send(snapshotFor('a1', 'US67066G1040', 'NVIDIA CORP', 1500));

    // Le bearer est mappé sur l'utilisateur #1 : il ne voit PAS les données d'Alice (id ≥ 2).
    const viaToken = await request(app)
      .get('/api/portfolio')
      .set({ Authorization: 'Bearer test_token_0123456789' });
    expect(viaToken.status).toBe(200);
    expect(viaToken.body.snapshot).toBeNull();
  });
});

describe('Réclamation des données historiques par le propriétaire', () => {
  it("OWNER_EMAIL récupère l'id 1 (et les données legacy) à sa première connexion", async () => {
    const prev = config.auth.ownerEmail;
    config.auth.ownerEmail = 'proprio@example.com';
    try {
      await getPool().query(
        `INSERT INTO snapshots (account_id, captured_at, snapshot_date, source, capture_id, total_value_eur)
         VALUES (1, '2026-07-01 10:00:00', '2026-07-01', 'extension', 'legacy-2', 12345)`,
      );
      // Un ami s'inscrit d'abord — il ne doit pas voler l'id 1.
      const friend = await register('rapide@example.com', 'Rapide');
      expect((await friend.get('/api/auth/me')).body.user.id).toBeGreaterThanOrEqual(2);

      // Le propriétaire se connecte ensuite : il réclame l'id 1 et voit ses données.
      const owner = await register('proprio@example.com', 'Proprio');
      const me = await owner.get('/api/auth/me');
      expect(me.body.user.id).toBe(1);
      const port = await owner.get('/api/portfolio');
      expect(port.body.snapshot?.total_value_eur).toBe('12345.00');
    } finally {
      config.auth.ownerEmail = prev;
    }
  });
});
