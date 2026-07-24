import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { config } from '../src/config.js';
import { resetDb } from './helpers.js';

const app = createApp();
const ADMIN = 'kevin@ponseel.fr';

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
  const verify = await agent.post('/api/auth/verify').send({ token: tokenFrom(link.body.devLink) });
  return { agent, verify };
}

/** Exécute `fn` avec ADMIN_EMAIL configuré, puis restaure. */
async function asAdminConfig(fn) {
  const prev = config.auth.adminEmail;
  config.auth.adminEmail = ADMIN;
  try {
    return await fn();
  } finally {
    config.auth.adminEmail = prev;
  }
}

describe('Administration (réservée à ADMIN_EMAIL)', () => {
  it("un utilisateur normal reçoit 403, l'admin voit la liste avec l'activité", async () => {
    await asAdminConfig(async () => {
      const { agent: user } = await register('ami@example.com', 'Ami');
      expect((await user.get('/api/admin/users')).status).toBe(403);

      const { agent: admin, verify } = await register(ADMIN, 'Kevin');
      expect(verify.body.user.isAdmin).toBe(true);

      const res = await admin.get('/api/admin/users');
      expect(res.status).toBe(200);
      const emails = res.body.users.map((u) => u.email);
      expect(emails).toContain('ami@example.com');
      expect(emails).toContain(ADMIN);
      const ami = res.body.users.find((u) => u.email === 'ami@example.com');
      expect(ami.login_count).toBe(1);
      expect(ami.last_login_at).toBeTruthy();
      expect(ami.active_sessions).toBe(1);
    });
  });

  it("l'admin édite email et pseudo, avec contrôles d'unicité", async () => {
    await asAdminConfig(async () => {
      const { agent: ami } = await register('ami@example.com', 'Ami');
      await register('autre@example.com', 'Autre');
      const { agent: admin } = await register(ADMIN, 'Kevin');
      const me = await ami.get('/api/auth/me');
      const amiId = me.body.user.id;

      // Édition valide
      const ok = await admin.patch(`/api/admin/users/${amiId}`).send({ email: 'nouveau@example.com', pseudo: 'AmiRenomme' });
      expect(ok.status).toBe(200);
      expect(ok.body.user.email).toBe('nouveau@example.com');
      expect(ok.body.user.pseudo).toBe('AmiRenomme');

      // Collisions refusées
      expect((await admin.patch(`/api/admin/users/${amiId}`).send({ pseudo: 'autre' })).status).toBe(409);
      expect((await admin.patch(`/api/admin/users/${amiId}`).send({ email: 'autre@example.com' })).status).toBe(409);
      expect((await admin.patch(`/api/admin/users/${amiId}`).send({ email: 'pas-un-email' })).status).toBe(400);
    });
  });

  it("l'admin supprime un compte (mais pas le sien)", async () => {
    await asAdminConfig(async () => {
      const { agent: ami } = await register('ami@example.com', 'Ami');
      const { agent: admin } = await register(ADMIN, 'Kevin');
      const amiId = (await ami.get('/api/auth/me')).body.user.id;
      const adminId = (await admin.get('/api/auth/me')).body.user.id;

      expect((await admin.delete(`/api/admin/users/${adminId}`)).status).toBe(400); // pas soi-même
      expect((await admin.delete(`/api/admin/users/${amiId}`)).status).toBe(200);
      expect((await ami.get('/api/auth/me')).status).toBe(401); // sessions révoquées
      const list = await admin.get('/api/admin/users');
      expect(list.body.users.map((u) => u.email)).not.toContain('ami@example.com');
    });
  });

  it('le compteur de connexions s’incrémente à chaque lien vérifié', async () => {
    await asAdminConfig(async () => {
      await register('ami@example.com', 'Ami'); // 1re connexion
      const relink = await request(app).post('/api/auth/request-link').send({ email: 'ami@example.com' });
      await request(app).post('/api/auth/verify').send({ token: tokenFrom(relink.body.devLink) }); // 2e

      const { agent: admin } = await register(ADMIN, 'Kevin');
      const list = await admin.get('/api/admin/users');
      expect(list.body.users.find((u) => u.email === 'ami@example.com').login_count).toBe(2);
    });
  });

  it("sans ADMIN_EMAIL configuré, personne n'est admin", async () => {
    const prevAdmin = config.auth.adminEmail;
    config.auth.adminEmail = '';
    try {
      const { agent } = await register('quelquun@example.com', 'X');
      expect((await agent.get('/api/admin/users')).status).toBe(403);
    } finally {
      config.auth.adminEmail = prevAdmin;
    }
  });
});
