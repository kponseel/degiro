import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { AUTH } from './helpers.js';

const app = createApp();

afterAll(async () => {
  await closePool();
});

describe('GET /api/health', () => {
  it('est public et renvoie 200 avec la base joignable', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('up');
    expect(['smtp', 'dev']).toContain(res.body.email);
    expect(typeof res.body.version).toBe('string');
  });
});

describe('route API inconnue (authentifiée)', () => {
  it('renvoie un 404 JSON', async () => {
    const res = await request(app).get('/api/inconnu').set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
  });
});
