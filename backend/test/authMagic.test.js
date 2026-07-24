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

async function loginAs(email, pseudo) {
  const agent = request.agent(app);
  const link = await agent.post('/api/auth/request-link').send({ email, pseudo });
  const verify = await agent.post('/api/auth/verify').send({ token: tokenFrom(link.body.devLink) });
  return { agent, verify, link };
}

describe('Auth par lien magique', () => {
  it('email inconnu sans pseudo → demande un pseudo, rien n’est envoyé', async () => {
    const res = await request(app).post('/api/auth/request-link').send({ email: 'new@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(res.body.needPseudo).toBe(true);
  });

  it('email invalide → 400', async () => {
    const res = await request(app).post('/api/auth/request-link').send({ email: 'pas-un-email', pseudo: 'x' });
    expect(res.status).toBe(400);
  });

  it('inscription (email+pseudo) → lien dev, puis vérification ouvre une session', async () => {
    const { verify, agent } = await loginAs('alice@example.com', 'Alice');
    expect(verify.status).toBe(200);
    expect(verify.body.user.email).toBe('alice@example.com');
    expect(verify.body.user.pseudo).toBe('Alice');
    // Cookie de session posé → /me fonctionne.
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('alice@example.com');
  });

  it('jeton invalide → 401', async () => {
    const res = await request(app).post('/api/auth/verify').send({ token: 'n-importe-quoi' });
    expect(res.status).toBe(401);
  });

  it('jeton à usage unique : deuxième vérification refusée', async () => {
    const link = await request(app).post('/api/auth/request-link').send({ email: 'bob@example.com', pseudo: 'Bob' });
    const token = tokenFrom(link.body.devLink);
    const first = await request(app).post('/api/auth/verify').send({ token });
    const second = await request(app).post('/api/auth/verify').send({ token });
    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
  });

  it('connexion (email seul) une fois le compte créé', async () => {
    await loginAs('carol@example.com', 'Carol');
    const relink = await request(app).post('/api/auth/request-link').send({ email: 'carol@example.com' });
    expect(relink.body.sent).toBe(true);
    expect(relink.body.devLink).toBeTruthy();
  });

  it('modifie le pseudo', async () => {
    const { agent } = await loginAs('dan@example.com', 'Dan');
    const res = await agent.patch('/api/auth/me').send({ pseudo: 'Daniel' });
    expect(res.status).toBe(200);
    expect(res.body.user.pseudo).toBe('Daniel');
  });

  it('déconnexion invalide la session', async () => {
    const { agent } = await loginAs('erin@example.com', 'Erin');
    await agent.post('/api/auth/logout');
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  it('/me exige une session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it("en production sans SMTP, le lien n'est JAMAIS exposé par l'API", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app)
        .post('/api/auth/request-link')
        .send({ email: 'prod@example.com', pseudo: 'Prod' });
      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).not.toContain('token=');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('supprime le compte', async () => {
    const { agent } = await loginAs('frank@example.com', 'Frank');
    const del = await agent.delete('/api/auth/me');
    expect(del.status).toBe(200);
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
    const relogin = await request(app).post('/api/auth/request-link').send({ email: 'frank@example.com' });
    expect(relogin.body.needPseudo).toBe(true); // le compte n'existe plus
  });
});
