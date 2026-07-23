import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';

const app = createApp();

afterAll(async () => {
  await closePool();
});

describe('GET /api/health', () => {
  it('renvoie 200 avec le statut, l\'état de la base et la version', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(['up', 'down']).toContain(res.body.db);
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.ts).toBe('string');
  });
});

describe('routes API inconnues', () => {
  it('renvoie un 404 JSON', async () => {
    const res = await request(app).get('/api/inconnu');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
  });
});
