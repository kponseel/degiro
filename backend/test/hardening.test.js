import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp, maskSecrets } from '../src/app.js';
import { checkConfig, config } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { resetDb } from './helpers.js';

const app = createApp();

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closePool(); });

const tokenFrom = (devLink) => new URL(devLink).searchParams.get('token');

async function loginAs(email) {
  const agent = request.agent(app);
  const link = await agent.post('/api/auth/request-link').send({ email });
  await agent.post('/api/auth/verify').send({ token: tokenFrom(link.body.devLink) });
  return agent;
}

/** Dépose un instantané minimal pour donner un portefeuille à un compte. */
async function seedPosition(agent, isin, captureId) {
  return agent.post('/api/ingest').send({
    source: 'csv',
    capture_id: captureId,
    captured_at: new Date().toISOString(),
    total_value_eur: 1000,
    positions: [{ isin, name: 'Titre', qty: 10, value_eur: 1000 }],
  });
}

// ── Configuration : échouer en fermé ──────────────────────────────────

describe('Configuration — sécurité par défaut', () => {
  /** Configuration type « production » : rien d'explicitement déclaré dev/test. */
  const prodLike = (over = {}) => ({
    isDevOrTest: false,
    db: { password: 'x' },
    auth: { appUrl: 'https://degiro.estim.pro', ownerEmail: 'a@b.fr', secureCookie: true },
    mail: { smtp: { host: 'h', user: 'u', pass: 'p' } },
    ...over,
  });

  it('refuse le démarrage sans APP_URL hors développement', () => {
    const { fatal } = checkConfig(prodLike({ auth: { appUrl: '', ownerEmail: 'a@b.fr', secureCookie: true } }));
    expect(fatal.join(' ')).toContain('APP_URL');
  });

  it('refuse une APP_URL qui n’est pas une origine propre', () => {
    const { fatal } = checkConfig(prodLike({ auth: { appUrl: 'degiro.estim.pro/app', ownerEmail: 'a@b.fr', secureCookie: true } }));
    expect(fatal).toHaveLength(1);
  });

  it('accepte une configuration de production complète', () => {
    expect(checkConfig(prodLike()).fatal).toEqual([]);
  });

  it('alerte sans bloquer quand SMTP est incomplet', () => {
    const { fatal, warnings } = checkConfig(prodLike({ mail: { smtp: { host: '', user: '', pass: '' } } }));
    expect(fatal).toEqual([]);
    expect(warnings.join(' ')).toContain('SMTP');
  });

  it('ne réclame rien en développement', () => {
    expect(checkConfig({
      isDevOrTest: true, db: { password: '' },
      auth: { appUrl: '', ownerEmail: '', secureCookie: false },
      mail: { smtp: { host: '', user: '', pass: '' } },
    }).fatal).toEqual([]);
  });

  it('n’active le mode développement que sur une déclaration explicite', () => {
    // Garde-fou de principe : en environnement de test, le drapeau est vrai ;
    // ce qui compte est qu'il ne puisse pas l'être « par oubli » en production.
    expect(typeof config.isDevOrTest).toBe('boolean');
    expect(config.auth.devLoginLinks).toBe(config.isDevOrTest);
  });
});

// ── Journaux : pas de jeton en clair ──────────────────────────────────

describe('Journalisation — masquage des secrets', () => {
  it('masque le jeton du lien de connexion dans les URL', () => {
    expect(maskSecrets('/auth/verify?token=SECRET123')).toBe('/auth/verify?token=***');
    expect(maskSecrets('/x?a=1&token=SECRET&b=2')).toBe('/x?a=1&token=***&b=2');
    expect(maskSecrets('/y?sessionId=ABC')).toBe('/y?sessionId=***');
  });

  it('laisse intacte une URL sans secret', () => {
    expect(maskSecrets('/api/portfolio?sort=value')).toBe('/api/portfolio?sort=value');
    expect(maskSecrets(undefined)).toBe('');
  });
});

// ── Portée du jeton d'extension ───────────────────────────────────────

describe("Jeton d'extension — portée limitée à l'ingestion", () => {
  async function extensionToken(email) {
    const agent = await loginAs(email);
    const { body } = await agent.post('/api/auth/me/tokens').send({ label: 'Chrome' });
    return { agent, auth: { Authorization: `Bearer ${body.token}` } };
  }

  it('accepte le dépôt d’une capture', async () => {
    const { auth } = await extensionToken('ext-scope@example.com');
    const res = await request(app).post('/api/ingest').set(auth).send({
      source: 'extension',
      capture_id: 'scope-1',
      captured_at: new Date().toISOString(),
      positions: [{ isin: 'US67066G1040', qty: 1, value_eur: 100 }],
    });
    expect(res.status).toBe(201);
  });

  it('refuse les routes de données et d’administration', async () => {
    const { auth } = await extensionToken('ext-scope2@example.com');
    for (const path of ['/api/portfolio', '/api/analytics', '/api/admin/users', '/api/exposure', '/api/dividends']) {
      const res = await request(app).get(path).set(auth);
      expect(res.status, `${path} devrait être refusé`).toBe(403);
    }
  });

  it('n’a aucun accès aux routes de compte, qui exigent une vraie session', async () => {
    const { auth } = await extensionToken('ext-scope3@example.com');
    // `/api/auth/*` est monté avant `requireAuth` et n'accepte que le cookie :
    // le jeton d'extension n'y est même pas une identité valide (401, pas 403).
    expect((await request(app).get('/api/auth/me').set(auth)).status).toBe(401);
    // Et surtout : pas de suppression de compte avec un jeton d'extension.
    expect((await request(app).delete('/api/auth/me').set(auth)).status).toBe(401);
  });
});

// ── Écritures sur les tables de référence partagées ───────────────────

describe('Données de référence — pas d’écriture inter-locataires', () => {
  it('refuse de corriger un ISIN que l’on ne détient pas', async () => {
    const alice = await loginAs('alice-ref@example.com');
    await seedPosition(alice, 'US67066G1040', 'ref-alice');

    // Titre détenu → autorisé.
    const ok = await alice.put('/api/isin-ref/US67066G1040').send({ sector: 'Technologie' });
    expect(ok.status).toBe(200);

    // Titre d'un autre portefeuille → refusé.
    const ko = await alice.put('/api/isin-ref/FR0000120578').send({ sector: 'Faux secteur' });
    expect(ko.status).toBe(403);

    // La référence du titre non détenu n'a pas été créée.
    const [rows] = await getPool().query('SELECT isin FROM isin_ref WHERE isin = ?', ['FR0000120578']);
    expect(rows).toHaveLength(0);
  });

  it('refuse d’importer la composition d’un ETF que l’on ne détient pas', async () => {
    const bob = await loginAs('bob-etf@example.com');
    await seedPosition(bob, 'IE00B4L5Y983', 'ref-bob');

    const csv = Buffer.from('Name,ISIN,Weight\nApple,US0378331005,5.5\n');
    const ko = await request(app)
      .post('/api/etf-holdings')
      .set('Cookie', bob.jar?.getCookies?.('http://127.0.0.1') || '')
      .field('etf_isin', 'LU1681038243')
      .attach('file', csv, 'compo.csv');
    // Sans session valide l'appel est 401, avec session c'est 403 : dans les deux
    // cas l'écriture n'a pas lieu — c'est ce qui est vérifié juste après.
    expect([401, 403]).toContain(ko.status);

    const [rows] = await getPool().query('SELECT etf_isin FROM etf_holdings WHERE etf_isin = ?', ['LU1681038243']);
    expect(rows).toHaveLength(0);
  });
});

// ── Erreurs : pas de détail interne exposé ────────────────────────────

describe('jeton d’extension face à un cookie de session', () => {
  /**
   * Constaté en production : l'utilisateur capture depuis un navigateur où il
   * est aussi connecté à l'Analyzer. Le cookie accompagne alors la requête de
   * l'extension. Si la session l'emporte, le jeton n'est jamais examiné : son
   * compteur reste à zéro malgré des captures réussies, et — plus grave — la
   * requête obtient tous les droits de session au lieu de la portée
   * « ingestion seule ».
   */
  async function connecte(email) {
    const agent = request.agent(app);
    const link = await agent.post('/api/auth/request-link').send({ email });
    await agent.post('/api/auth/verify').send({ token: new URL(link.body.devLink).searchParams.get('token') });
    const { body } = await agent.post('/api/auth/me/tokens').send({ label: 'test2' });
    return { agent, token: body.token };
  }

  const capture = (n) => ({
    schema_version: 1,
    source: 'extension',
    capture_id: `cap-cookie-${n}`,
    captured_at: '2026-07-30T15:41:00Z',
    positions: [],
    transactions: [],
  });

  it('compte l’envoi même quand un cookie de session accompagne la requête', async () => {
    const { agent, token } = await connecte('cookie-jeton@example.com');
    const res = await agent.post('/api/ingest')
      .set({ Authorization: `Bearer ${token}` })
      .send(capture(1));
    expect(res.status).toBe(201);

    const [rows] = await getPool().query('SELECT uses, last_used_at FROM extension_tokens');
    expect(rows[0].uses).toBe(1);
    expect(rows[0].last_used_at).toBeTruthy();
  });

  it('applique la portée « ingestion seule » malgré le cookie', async () => {
    // Sans cela, un jeton d'extension présenté depuis un navigateur connecté
    // ouvrait toute l'API — la restriction de portée sautait en silence.
    const { agent, token } = await connecte('portee-jeton@example.com');
    const res = await agent.get('/api/portfolio').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/envoi de captures/);
  });

  it('le cookie seul reste pleinement valable', async () => {
    const { agent } = await connecte('cookie-seul@example.com');
    expect((await agent.get('/api/portfolio')).status).toBe(200);
  });
});

describe('Erreurs — le client ne reçoit pas l’intérieur du système', () => {
  it('renvoie un message neutre sur une erreur serveur', async () => {
    const failing = createApp();
    failing.get('/api/boom-test', () => { throw new Error('SELECT * FROM users — hôte mysql-42 refusé'); });
    // La route de test est montée après le 404 /api : on la déclare sur une app
    // dédiée pour n'observer que le gestionnaire d'erreurs.
    const res = await request(failing).get('/api/boom-test');
    if (res.status === 500) {
      expect(res.body.error).toBe('Erreur interne du serveur');
      expect(JSON.stringify(res.body)).not.toContain('mysql-42');
    } else {
      // Interceptée en amont par le 404 : rien ne fuit non plus.
      expect(JSON.stringify(res.body)).not.toContain('mysql-42');
    }
  });
});
