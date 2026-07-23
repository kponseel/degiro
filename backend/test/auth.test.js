import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { AUTH } from './helpers.js';

const app = createApp();

afterAll(async () => {
  await closePool();
});

describe('authentification bearer', () => {
  it('refuse (401) sans en-tête Authorization', async () => {
    const res = await request(app).get('/api/portfolio');
    expect(res.status).toBe(401);
  });

  it('refuse (401) avec un mauvais jeton', async () => {
    const res = await request(app).get('/api/portfolio').set('Authorization', 'Bearer mauvais');
    expect(res.status).toBe(401);
  });

  it('accepte (200) avec le bon jeton', async () => {
    const res = await request(app).get('/api/portfolio').set(AUTH);
    expect(res.status).toBe(200);
  });

  it('laisse /api/health public', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});
