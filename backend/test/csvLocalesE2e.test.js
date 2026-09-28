import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { resetDb } from './helpers.js';

const app = createApp();
const fixturePath = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const fixture = (name) => readFileSync(fixturePath(name));

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closePool(); });

async function signIn(email) {
  const agent = request.agent(app);
  const link = await agent.post('/api/auth/request-link').send({ email });
  await agent.post('/api/auth/verify').send({ token: new URL(link.body.devLink).searchParams.get('token') });
  return agent;
}

const upload = (agent, file) => agent
  .post('/api/ingest/csv')
  .field('mode', 'commit')
  .attach('file', fixture(file), file);

const EN = 'portfolio-real.csv';
const FR = 'portfolio-real-fr.csv';

/**
 * Le trajet complet, dans les deux langues : un utilisateur dépose son export
 * de portefeuille et regarde son tableau de bord. Les tests unitaires vérifient
 * la lecture du fichier ; celui-ci vérifie que ce qui s'affiche au bout est
 * juste, et identique quelle que soit la langue de l'export.
 */
async function importPortfolio(email, file) {
  const agent = await signIn(email);
  const res = await upload(agent, file);
  expect(res.status, `import de ${file}`).toBe(200);
  expect(res.body.kind).toBe('portfolio');
  return (await agent.get('/api/portfolio')).body;
}

describe.each([['anglais', EN], ['français', FR]])('import du portefeuille — %s', (langue, file) => {
  it('affiche le portefeuille et ses liquidités', async () => {
    const portfolio = await importPortfolio(`e2e-${langue}@example.com`, file);
    expect(portfolio.positions).toHaveLength(27);
    expect(Number(portfolio.snapshot.cash_eur)).toBe(6435.86);
    expect(Number(portfolio.snapshot.total_value_eur)).toBeGreaterThan(80000);
  });
});

describe('les deux langues donnent le même tableau de bord', () => {
  it('mêmes positions, mêmes liquidités', async () => {
    const en = await importPortfolio('parite-en@example.com', EN);
    const fr = await importPortfolio('parite-fr@example.com', FR);

    const positions = (d) => d.positions
      .map((p) => `${p.isin}|${Number(p.qty)}|${Number(p.value_eur)}|${p.currency}`)
      .sort();
    expect(positions(fr)).toEqual(positions(en));
    expect(Number(fr.snapshot.cash_eur)).toBe(Number(en.snapshot.cash_eur));
    expect(Number(fr.snapshot.total_value_eur)).toBe(Number(en.snapshot.total_value_eur));
  });
});

/**
 * Seul le Portfolio.csv est encore importé. Un relevé de compte ou un
 * historique d'ordres déposé par habitude doit être refusé en disant quoi faire
 * — et sans rien écrire.
 */
describe('détection du type de fichier', () => {
  it.each(['portfolio-real.csv', 'portfolio-real-fr.csv'])('%s → portefeuille', async (file) => {
    const agent = await signIn(`detect-${file}@example.com`);
    const res = await agent.post('/api/ingest/csv').field('mode', 'preview').attach('file', fixture(file), file);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('portfolio');
    expect(res.body.count).toBeGreaterThan(0);
  });

  it.each([
    ['account-real-en.csv', /relevé de compte/],
    ['account-real-fr.csv', /relevé de compte/],
    ['transactions-real-en.csv', /historique d'ordres/],
    ['transactions-real-fr.csv', /historique d'ordres/],
  ])('%s → refusé avec explication', async (file, message) => {
    const agent = await signIn(`refus-${file}@example.com`);
    const res = await upload(agent, file);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(message);
    expect(res.body.error).toMatch(/Portfolio\.csv/);
    const pf = (await agent.get('/api/portfolio')).body;
    expect(pf.snapshot).toBeNull();
  });
});
