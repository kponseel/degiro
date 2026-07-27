import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { resetDb } from './helpers.js';
import { config } from '../src/config.js';
import { setInviteCode, getInviteCode, inviteCodeAccepts, normalizeCode } from '../src/services/settings.js';

const app = createApp();

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closePool(); });

const tokenFrom = (devLink) => new URL(devLink).searchParams.get('token');

/** Ouvre une session complète pour un email (le compte est créé au besoin). */
async function loginAs(email, inviteCode) {
  const agent = request.agent(app);
  const link = await agent.post('/api/auth/request-link').send({ email, invite_code: inviteCode });
  if (!link.body.devLink) return { agent, link, verify: null };
  const verify = await agent.post('/api/auth/verify').send({ token: tokenFrom(link.body.devLink) });
  return { agent, link, verify };
}

// ── Le service ───────────────────────────────────────────────────────

describe('Code d’invitation — service', () => {
  it('n’exige rien tant qu’aucun code n’est configuré', async () => {
    expect(await getInviteCode()).toBeNull();
    expect(await inviteCodeAccepts(undefined)).toBe(true);
    expect(await inviteCodeAccepts('nimporte quoi')).toBe(true);
  });

  it('accepte le bon code, sans tenir compte de la casse ni des espaces de bord', async () => {
    await setInviteCode('kev2026');
    expect(await inviteCodeAccepts('kev2026')).toBe(true);
    // Un code se recopie à la main, souvent depuis un message : exiger la casse
    // exacte ne protège de rien et bloque des invités légitimes.
    expect(await inviteCodeAccepts('KEV2026')).toBe(true);
    expect(await inviteCodeAccepts('  Kev2026 ')).toBe(true);
    expect(await inviteCodeAccepts('kev2025')).toBe(false);
    expect(await inviteCodeAccepts('')).toBe(false);
    expect(await inviteCodeAccepts(undefined)).toBe(false);
  });

  it('refuse un code trop court, qui se devinerait', async () => {
    expect((await setInviteCode('abc')).error).toBe('too_short');
    expect(await getInviteCode()).toBeNull();
  });

  it('une valeur vide retire le code et rouvre l’inscription', async () => {
    await setInviteCode('kev2026');
    const res = await setInviteCode('');
    expect(res.code).toBeNull();
    expect(await getInviteCode()).toBeNull();
    expect(await inviteCodeAccepts('nimporte quoi')).toBe(true);
  });

  it('normalise de la même façon des deux côtés', () => {
    expect(normalizeCode('  KeV2026 ')).toBe('kev2026');
    expect(normalizeCode(null)).toBe('');
  });
});

// ── Le flux d'inscription ────────────────────────────────────────────

describe('Code d’invitation — inscription', () => {
  it('refuse la création d’un compte sans le code', async () => {
    await setInviteCode('kev2026');
    const res = await request(app).post('/api/auth/request-link').send({ email: 'inconnu@example.com' });
    expect(res.status).toBe(403);
    expect(res.body.needsInvite).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('token=');
  });

  it('refuse un code erroné', async () => {
    await setInviteCode('kev2026');
    const res = await request(app).post('/api/auth/request-link')
      .send({ email: 'inconnu@example.com', invite_code: 'kev2025' });
    expect(res.status).toBe(403);
  });

  it('accepte la création avec le bon code', async () => {
    await setInviteCode('kev2026');
    const { verify } = await loginAs('ami@example.com', 'kev2026');
    expect(verify.status).toBe(200);
    expect(verify.body.user.email).toBe('ami@example.com');
  });

  it('n’exige AUCUN code pour se reconnecter à un compte existant', async () => {
    // Sinon, changer le code couperait l'accès à tous les inscrits.
    await setInviteCode('kev2026');
    await loginAs('ami2@example.com', 'kev2026');

    await setInviteCode('nouveau-code-2027');
    const { verify } = await loginAs('ami2@example.com'); // aucun code fourni
    expect(verify.status).toBe(200);
  });

  it('laisse l’inscription ouverte quand aucun code n’est posé', async () => {
    const { verify } = await loginAs('libre@example.com');
    expect(verify.status).toBe(200);
  });
});

// ── L'administration ─────────────────────────────────────────────────

describe('Code d’invitation — administration', () => {
  const ADMIN = 'admin@example.com';

  /**
   * Ouvre une session administrateur. Le code en vigueur est relu et fourni :
   * sans lui, la création du compte admin serait elle-même bloquée par la porte
   * que ces tests installent.
   */
  async function adminAgent() {
    config.auth.adminEmail = ADMIN;
    const code = await getInviteCode();
    const { agent } = await loginAs(ADMIN, code || undefined);
    return agent;
  }

  it('un utilisateur non administrateur ne peut ni lire ni changer le code', async () => {
    await adminAgent(); // installe l'admin
    const { agent } = await loginAs('quidam@example.com');
    expect((await agent.get('/api/admin/invite-code')).status).toBe(403);
    expect((await agent.put('/api/admin/invite-code').send({ code: 'pirate2026' })).status).toBe(403);
    // Le code n'a pas bougé.
    expect(await getInviteCode()).toBeNull();
  });

  it('l’administrateur lit le code en vigueur', async () => {
    await setInviteCode('kev2026');
    const agent = await adminAgent();
    const res = await agent.get('/api/admin/invite-code');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: 'kev2026', open: false });
  });

  it('l’administrateur change le code, effet immédiat', async () => {
    await setInviteCode('kev2026');
    const agent = await adminAgent();

    const put = await agent.put('/api/admin/invite-code').send({ code: 'nouveau2027' });
    expect(put.status).toBe(200);
    expect(put.body.code).toBe('nouveau2027');

    // L'ancien ne passe plus, le nouveau oui — sans redémarrage.
    const ancien = await request(app).post('/api/auth/request-link')
      .send({ email: 'a@example.com', invite_code: 'kev2026' });
    expect(ancien.status).toBe(403);

    const nouveau = await request(app).post('/api/auth/request-link')
      .send({ email: 'b@example.com', invite_code: 'nouveau2027' });
    expect(nouveau.status).toBe(200);
  });

  it('refuse un code trop court avec un message explicite', async () => {
    const agent = await adminAgent();
    const res = await agent.put('/api/admin/invite-code').send({ code: 'ab' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/trop court/i);
  });

  it('vider le code rouvre l’inscription, et le signale', async () => {
    await setInviteCode('kev2026');
    const agent = await adminAgent();
    const res = await agent.put('/api/admin/invite-code').send({ code: '' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: null, open: true });

    const libre = await request(app).post('/api/auth/request-link').send({ email: 'c@example.com' });
    expect(libre.status).toBe(200);
  });
});
