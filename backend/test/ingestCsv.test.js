import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { AUTH, resetDb } from './helpers.js';

const app = createApp();
const fixturePath = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe('POST /api/ingest/csv — portfolio', () => {
  it('prévisualise sans persister', async () => {
    const res = await request(app)
      .post('/api/ingest/csv')
      .set(AUTH)
      .field('kind', 'portfolio')
      .field('mode', 'preview')
      .attach('file', fixturePath('portfolio.csv'));
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('portfolio');
    expect(res.body.count).toBe(3);

    const pf = await request(app).get('/api/portfolio').set(AUTH);
    expect(pf.body.snapshot).toBeNull();
  });

  it('commit crée un snapshot csv visible via /api/portfolio', async () => {
    const res = await request(app)
      .post('/api/ingest/csv')
      .set(AUTH)
      .field('kind', 'portfolio')
      .field('mode', 'commit')
      .attach('file', fixturePath('portfolio.csv'));
    expect(res.status).toBe(200);
    expect(res.body.positions).toBe(3);

    const pf = await request(app).get('/api/portfolio').set(AUTH);
    expect(pf.body.positions).toHaveLength(3);
    expect(pf.body.snapshot.source).toBe('csv');
    // positions (11910,80) + liquidités (500) = 12410,80
    expect(Number(pf.body.snapshot.total_value_eur)).toBeCloseTo(12410.8, 1);
    expect(Number(pf.body.snapshot.cash_eur)).toBeCloseTo(500, 1);
  });

  it('auto-détecte le type sans paramètre kind', async () => {
    const res = await request(app)
      .post('/api/ingest/csv')
      .set(AUTH)
      .field('mode', 'preview')
      .attach('file', fixturePath('portfolio.csv'));
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('portfolio');
  });
});

describe('POST /api/ingest/csv — account & transactions', () => {
  it('importe le relevé de compte, idempotent au ré-import', async () => {
    const first = await request(app)
      .post('/api/ingest/csv')
      .set(AUTH)
      .field('mode', 'commit')
      .attach('file', fixturePath('account.csv'));
    expect(first.status).toBe(200);
    expect(first.body.kind).toBe('account');
    expect(first.body.inserted).toBe(4);

    const again = await request(app)
      .post('/api/ingest/csv')
      .set(AUTH)
      .field('mode', 'commit')
      .attach('file', fixturePath('account.csv'));
    expect(again.body.inserted).toBe(0);
  });

  it('importe les transactions (buy/sell)', async () => {
    const res = await request(app)
      .post('/api/ingest/csv')
      .set(AUTH)
      .field('mode', 'commit')
      .attach('file', fixturePath('transactions.csv'));
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('transactions');
    expect(res.body.inserted).toBe(2);
  });
});

describe('POST /api/ingest/csv — erreurs', () => {
  it('refuse (401) sans authentification', async () => {
    const res = await request(app)
      .post('/api/ingest/csv')
      .attach('file', fixturePath('portfolio.csv'));
    expect(res.status).toBe(401);
  });

  it('renvoie 400 sans fichier', async () => {
    const res = await request(app).post('/api/ingest/csv').set(AUTH).field('kind', 'portfolio');
    expect(res.status).toBe(400);
  });
});
