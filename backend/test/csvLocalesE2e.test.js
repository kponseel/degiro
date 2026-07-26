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

/** Importe les trois exports d'une langue et renvoie ce que voit le dashboard. */
async function importAll(email, { portfolio, account, transactions }) {
  const agent = await signIn(email);
  const kinds = [];
  for (const file of [portfolio, account, transactions]) {
    const res = await upload(agent, file);
    expect(res.status, `import de ${file}`).toBe(200);
    kinds.push(res.body.kind);
  }
  const [port, div, perf] = await Promise.all([
    agent.get('/api/portfolio'),
    agent.get('/api/dividends'),
    agent.get('/api/performance'),
  ]);
  return { agent, kinds, portfolio: port.body, dividends: div.body, performance: perf.body };
}

const EN = { portfolio: 'portfolio-real.csv', account: 'account-real-en.csv', transactions: 'transactions-real-en.csv' };
const FR = { portfolio: 'portfolio-real-fr.csv', account: 'account-real-fr.csv', transactions: 'transactions-real-fr.csv' };

/**
 * Le trajet complet, dans les deux langues : un utilisateur dépose ses trois
 * exports DEGIRO et regarde son tableau de bord. Les tests unitaires vérifient
 * la lecture des fichiers ; celui-ci vérifie que ce qui s'affiche au bout est
 * juste, et identique quelle que soit la langue de l'export.
 */
describe.each([['anglais', EN], ['français', FR]])('import DEGIRO complet — %s', (langue, files) => {
  it('range chaque fichier dans le bon importeur', async () => {
    const { kinds } = await importAll(`e2e-${langue}@example.com`, files);
    expect(kinds).toEqual(['portfolio', 'account', 'transactions']);
  });

  it('affiche le portefeuille et ses liquidités', async () => {
    const { portfolio } = await importAll(`e2e2-${langue}@example.com`, files);
    expect(portfolio.positions).toHaveLength(27);
    expect(Number(portfolio.snapshot.cash_eur)).toBe(6435.86);
    expect(Number(portfolio.snapshot.total_value_eur)).toBeGreaterThan(80000);
  });

  it('affiche les dividendes, net de retenue', async () => {
    const { dividends } = await importAll(`e2e3-${langue}@example.com`, files);
    const usd = dividends.currencies.find((c) => c.currency === 'USD');
    expect(usd, 'un bucket USD est attendu').toBeTruthy();
    expect(Number(usd.gross)).toBe(12.5);
    expect(Number(usd.tax)).toBe(-1.88);
    expect(Number(usd.net)).toBeCloseTo(10.62, 2);
    expect(dividends.payers.some((p) => p.isin === 'US67066G1040')).toBe(true);
  });

  it('le TWR voit les versements du relevé', async () => {
    const agent = await signIn(`e2e4-${langue}@example.com`);
    expect((await upload(agent, files.account)).status).toBe(200);

    // Le TWR a besoin d'au moins deux points ; on encadre le retrait du 25/07.
    const snapshot = (captureId, at, value) => agent.post('/api/ingest').send({
      source: 'extension', capture_id: captureId, captured_at: at, total_value_eur: value,
      positions: [{ isin: 'US67066G1040', name: 'NVIDIA', product_type: 'STOCK', value_eur: value }],
    });
    await snapshot('twr-1', '2026-07-01T09:00:00Z', 10000);
    await snapshot('twr-2', '2026-07-31T09:00:00Z', 10400);

    const { body } = await agent.get('/api/performance');
    expect(body.insufficient).toBe(false);
    // Sans dépôt/retrait reconnus, ce compteur reste à zéro et le TWR se
    // confond alors avec la courbe brute — le défaut exact qu'on traque ici.
    expect(body.flows).toBeGreaterThan(0);
    expect(Number.isFinite(body.twr)).toBe(true);
    // Le retrait de 200 € ne doit pas passer pour une perte : le TWR reste
    // au-dessus de la variation brute (+4 %).
    expect(body.twr).toBeGreaterThan(0.04);
  });
});

describe('la taxe de transaction ne rogne pas les dividendes', () => {
  it('le net ne retranche que la retenue à la source', async () => {
    const agent = await signIn('ttf@example.com');
    expect((await upload(agent, 'account-real-mixed.csv')).status).toBe(200);

    const { body } = await agent.get('/api/dividends');
    const usd = body.currencies.find((c) => c.currency === 'USD');

    // Le fichier porte 38,10 $ de dividendes et 1,46 $ de retenue, plus
    // 1,95 € de TTF et stamp duty qui n'ont rien à voir avec eux.
    expect(Number(usd.gross)).toBeCloseTo(38.1, 2);
    expect(Number(usd.tax)).toBeCloseTo(-1.46, 2);
    expect(Number(usd.net)).toBeCloseTo(36.64, 2);

    // Aucun seau ne doit contenir la taxe de transaction, en euro comme ailleurs.
    const eur = body.currencies.find((c) => c.currency === 'EUR');
    expect(eur).toBeUndefined();
  });
});

describe('les deux langues donnent le même tableau de bord', () => {
  it('mêmes positions, mêmes dividendes, mêmes liquidités', async () => {
    const en = await importAll('parite-en@example.com', EN);
    const fr = await importAll('parite-fr@example.com', FR);

    const positions = (d) => d.portfolio.positions
      .map((p) => `${p.isin}|${Number(p.qty)}|${Number(p.value_eur)}|${p.currency}`)
      .sort();
    expect(positions(fr)).toEqual(positions(en));

    expect(Number(fr.portfolio.snapshot.cash_eur)).toBe(Number(en.portfolio.snapshot.cash_eur));
    expect(Number(fr.portfolio.snapshot.total_value_eur)).toBe(Number(en.portfolio.snapshot.total_value_eur));

    const divs = (d) => d.dividends.currencies
      .map((c) => `${c.currency}|${Number(c.gross)}|${Number(c.tax)}|${Number(c.net)}`)
      .sort();
    expect(divs(fr)).toEqual(divs(en));
  });
});

describe('détection automatique du type de fichier', () => {
  it.each([
    ['account-real-en.csv', 'account'],
    ['account-real-fr.csv', 'account'],
    ['transactions-real-en.csv', 'transactions'],
    ['transactions-real-fr.csv', 'transactions'],
    ['portfolio-real.csv', 'portfolio'],
    ['portfolio-real-fr.csv', 'portfolio'],
  ])('%s → %s', async (file, expected) => {
    const agent = await signIn(`detect-${file}@example.com`);
    const res = await agent.post('/api/ingest/csv').field('mode', 'preview').attach('file', fixture(file), file);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe(expected);
    expect(res.body.count).toBeGreaterThan(0);
  });
});
