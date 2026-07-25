import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import {
  flattenRow, parsePortfolio, parseTotals, chunk, indexProducts, toPosition, buildPayload,
} from '../../extension/src/degiro.js';
import { readFileSync } from 'node:fs';
import { sniff, isComplete, intAccountFromClient, urls, PATTERNS } from '../../extension/src/session.js';
import { ingestSchema } from '../src/schemas/ingest.js';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { resetDb } from './helpers.js';

/** Reconstitue le format DEGIRO : des listes [{name, value}] imbriquées. */
const row = (id, fields) => ({
  name: 'Row',
  id,
  value: Object.entries(fields).map(([name, value]) => ({ name, value })),
});

const update = {
  portfolio: {
    name: 'portfolio',
    value: [
      row('331868', {
        id: '331868', positionType: 'PRODUCT', size: 10, price: 120.5, value: 1105,
        plBase: { EUR: -1000 }, todayPlBase: { EUR: -1080 }, portfolioValueCorrection: 0,
        breakEvenPrice: 100, averageFxRate: 1.09,
      }),
      row('1153605', {
        id: '1153605', positionType: 'PRODUCT', size: 100, price: 95, value: 9500,
        plBase: { EUR: -8700 }, todayPlBase: { EUR: -9460 }, portfolioValueCorrection: 0,
        breakEvenPrice: 87, averageFxRate: 1,
      }),
      // Ligne soldée : DEGIRO la garde, nous non.
      row('999999', { id: '999999', positionType: 'PRODUCT', size: 0, price: 12, value: 0 }),
      row('EUR', { id: 'EUR', positionType: 'CASH', value: 300.25 }),
      row('FLATEX_EUR', { id: 'FLATEX_EUR', positionType: 'CASH', value: 199.75 }),
      row('FLATEX_USD', { id: 'FLATEX_USD', positionType: 'CASH', value: 42 }),
    ],
  },
  totalPortfolio: {
    name: 'totalPortfolio',
    value: [
      { name: 'reportPortfValue', value: 10605 },
      { name: 'reportCashBal', value: 500 },
      { name: 'reportNetliq', value: 11105 },
    ],
  },
};

const productsInfo = [{
  data: {
    331868: { id: '331868', isin: 'US67066G1040', symbol: 'NVDA', name: 'NVIDIA Corporation', productType: 'STOCK', currency: 'USD' },
    1153605: { id: '1153605', isin: 'IE00B4L5Y983', symbol: 'IWDA', name: 'iShares Core MSCI World', productType: 'ETF', currency: 'EUR' },
  },
}];

describe('Extension — lecture du format DEGIRO', () => {
  it('aplatit les listes [{name, value}] en objet', () => {
    expect(flattenRow(row('1', { size: 3, price: 9 }))).toEqual({ size: 3, price: 9 });
    expect(flattenRow(undefined)).toEqual({});
    expect(flattenRow({ value: [null, { value: 1 }] })).toEqual({});
  });

  it('sépare titres et liquidités, et écarte les lignes soldées', () => {
    const { products, cashEur } = parsePortfolio(update);
    expect(products.map((p) => p.productId)).toEqual(['331868', '1153605']);
    // EUR + FLATEX_EUR ; l'USD est ignoré faute de taux de change ici.
    expect(cashEur).toBe(500);
  });

  it('ne renvoie aucune liquidité quand il n’y en a pas', () => {
    const { cashEur } = parsePortfolio({ portfolio: { value: [] } });
    expect(cashEur).toBeUndefined();
  });

  it('lit les totaux annoncés par DEGIRO', () => {
    expect(parseTotals(update)).toEqual({ positions: 10605, cash: 500, netLiq: 11105 });
  });

  it('reconstitue le total quand netliq est absent', () => {
    const partial = { totalPortfolio: { value: [{ name: 'reportPortfValue', value: 100 }, { name: 'reportCashBal', value: 5 }] } };
    expect(parseTotals(partial).netLiq).toBe(105);
  });

  it('fusionne les lots de products/info en un index', () => {
    const index = indexProducts([{ data: { 1: { isin: 'A' } } }, { data: { 2: { isin: 'B' } } }, null]);
    expect(Object.keys(index)).toEqual(['1', '2']);
  });

  it('découpe les identifiants en lots de 100', () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    expect(chunk(ids, 100).map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunk([], 100)).toEqual([]);
  });
});

describe('Extension — conversion en positions', () => {
  it('calcule P/L et P/L du jour à partir des bases de coût', () => {
    const p = toPosition(flattenRow(update.portfolio.value[0]), productsInfo[0].data[331868]);
    expect(p).toMatchObject({
      isin: 'US67066G1040', symbol: 'NVDA', product_type: 'STOCK', currency: 'USD',
      qty: 10, price: 120.5, value_eur: 1105, break_even_price: 100, fx_rate: 1.09,
    });
    expect(p.pl_eur).toBe(105); // 1105 - 1000
    expect(p.pl_day_eur).toBe(25); // 1105 - 1080
  });

  it('écarte une ligne sans ISIN exploitable', () => {
    const r = flattenRow(update.portfolio.value[0]);
    expect(toPosition(r, undefined)).toBeNull();
    expect(toPosition(r, { isin: '' })).toBeNull();
    expect(toPosition(r, { isin: 'PAS-UN-ISIN' })).toBeNull();
  });

  it('omet les champs absents plutôt que d’inventer des zéros', () => {
    const p = toPosition({ size: 5 }, { isin: 'FR0000120271' });
    expect(p.value_eur).toBeUndefined();
    expect(p.pl_eur).toBeUndefined();
    expect(p.pl_day_eur).toBeUndefined();
    expect(p.currency).toBeUndefined();
  });

  it('tronque les champs trop longs au lieu de faire échouer l’envoi', () => {
    const p = toPosition({ size: 1 }, { isin: 'FR0000120271', name: 'x'.repeat(400), symbol: 'y'.repeat(40) });
    expect(p.name).toHaveLength(255);
    expect(p.symbol).toHaveLength(20);
  });
});

describe('Extension — payload envoyé à l’API', () => {
  const built = buildPayload({
    update, products: productsInfo, captureId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', capturedAt: '2026-07-25T09:00:00Z',
  });

  it('produit un payload accepté par le schéma d’ingestion', () => {
    const parsed = ingestSchema.safeParse(built.payload);
    expect(parsed.success).toBe(true);
  });

  it('reprend la convention de l’import CSV : titres + liquidités', () => {
    expect(built.payload.total_value_eur).toBe(11105);
    expect(built.payload.cash_eur).toBe(500);
    expect(built.payload.source).toBe('extension');
    expect(built.payload.positions).toHaveLength(2);
  });

  it('signale un écart entre notre somme et le total DEGIRO', () => {
    expect(built.diagnostics.totalGap).toBe(0);

    const faussé = structuredClone(update);
    faussé.totalPortfolio.value[2].value = 12000;
    const d = buildPayload({ update: faussé, products: productsInfo, captureId: 'x', capturedAt: '2026-07-25T09:00:00Z' }).diagnostics;
    expect(d.totalGap).toBe(895);
  });

  it('remonte les positions ignorées faute d’ISIN', () => {
    const d = buildPayload({ update, products: [], captureId: 'x', capturedAt: '2026-07-25T09:00:00Z' }).diagnostics;
    expect(d.held).toBe(2);
    expect(d.sent).toBe(0);
    expect(d.skipped.map((s) => s.productId)).toEqual(['331868', '1153605']);
  });

  it('retombe sur sa propre somme si DEGIRO ne donne pas de total', () => {
    const sansTotal = { portfolio: update.portfolio };
    const p = buildPayload({ update: sansTotal, products: productsInfo, captureId: 'x', capturedAt: '2026-07-25T09:00:00Z' });
    expect(p.payload.total_value_eur).toBe(11105); // 1105 + 9500 + 500
    expect(p.diagnostics.totalGap).toBeNull();
  });

  it('tronque capture_id à la limite de la colonne', () => {
    const p = buildPayload({ update, products: productsInfo, captureId: 'z'.repeat(80), capturedAt: '2026-07-25T09:00:00Z' });
    expect(p.payload.capture_id).toHaveLength(36);
    expect(ingestSchema.safeParse(p.payload).success).toBe(true);
  });

  it('survit à un portefeuille vide sans planter', () => {
    const p = buildPayload({ update: {}, products: [], captureId: 'x', capturedAt: '2026-07-25T09:00:00Z' });
    expect(p.payload.positions).toEqual([]);
    expect(p.payload.total_value_eur).toBe(0);
  });
});

describe('Extension — repérage de la session DEGIRO', () => {
  it('lit sessionId et intAccount dans les URLs de l’application', () => {
    expect(sniff('https://trader.degiro.nl/trading/secure/v5/update/12345678;jsessionid=ABCDEF123456?portfolio=0'))
      .toEqual({ sessionId: 'ABCDEF123456', intAccount: '12345678' });
    expect(sniff('https://trader.degiro.nl/pa/secure/client?sessionId=XYZ987654321'))
      .toEqual({ sessionId: 'XYZ987654321' });
    expect(sniff('https://trader.degiro.nl/product_search/secure/v5/products/info?intAccount=87654321&sessionId=QWERTY123456'))
      .toEqual({ sessionId: 'QWERTY123456', intAccount: '87654321' });
  });

  it('ne retient rien d’une URL sans identifiants', () => {
    expect(sniff('https://trader.degiro.nl/assets/app.js')).toEqual({});
    expect(sniff(undefined)).toEqual({});
    // Trop court pour être une session : on préfère ne rien retenir.
    expect(sniff('https://trader.degiro.nl/x?sessionId=abc')).toEqual({});
  });

  it('sait quand les identifiants suffisent', () => {
    expect(isComplete({ sessionId: 'a', intAccount: '1' })).toBe(true);
    expect(isComplete({ sessionId: 'a' })).toBe(false);
    expect(isComplete(null)).toBe(false);
  });

  it('lit intAccount dans la réponse client, enveloppée ou non', () => {
    expect(intAccountFromClient({ data: { intAccount: 12345678 } })).toBe('12345678');
    expect(intAccountFromClient({ intAccount: 12345678 })).toBe('12345678');
    expect(intAccountFromClient({})).toBeNull();
  });

  it('construit des URLs DEGIRO échappées', () => {
    expect(urls.update('123', 'a b')).toContain(';jsessionid=a%20b');
    expect(urls.update('123', 'x')).toContain('/v5/update/123;');
    expect(urls.productsInfo('123', 'x')).toContain('intAccount=123');
    // Toutes les URLs restent sur l'origine DEGIRO — le script de contenu refuse le reste.
    for (const u of [urls.client('x'), urls.update('1', 'x'), urls.productsInfo('1', 'x')]) {
      expect(u.startsWith(urls.origin)).toBe(true);
    }
  });

  it('boucle : ce que sniff lit dans une URL construite est ce qu’on y a mis', () => {
    expect(sniff(urls.update('12345678', 'SESSION123456'))).toEqual({
      sessionId: 'SESSION123456', intAccount: '12345678',
    });
  });

  it('les motifs dupliqués dans inject.js n’ont pas divergé', () => {
    // `inject.js` tourne dans la page et ne peut pas importer de module : ses
    // motifs sont recopiés. Ce test est le garde-fou contre la dérive.
    const source = readFileSync(new URL('../../extension/src/inject.js', import.meta.url), 'utf8');
    for (const { re } of PATTERNS) {
      expect(source, `motif absent de inject.js : ${re}`).toContain(re.source);
    }
  });
});

/**
 * Le maillon que les tests unitaires ne couvrent pas : est-ce que le payload
 * réellement produit par l'extension traverse l'API et ressort correct côté
 * portefeuille ? On rejoue ici tout le trajet, avec un vrai jeton d'extension.
 */
describe('Extension — trajet complet jusqu’au portefeuille', () => {
  const app = createApp();

  beforeEach(async () => { await resetDb(); });
  afterAll(async () => { await closePool(); });

  it('capture DEGIRO → ingestion par jeton → portefeuille affiché', async () => {
    const agent = request.agent(app);
    const link = await agent.post('/api/auth/request-link').send({ email: 'ext-e2e@example.com' });
    await agent.post('/api/auth/verify').send({ token: new URL(link.body.devLink).searchParams.get('token') });
    const { body: created } = await agent.post('/api/auth/me/tokens').send({ label: 'Chrome' });

    const { payload } = buildPayload({
      update, products: productsInfo,
      captureId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      capturedAt: '2026-07-25T09:00:00Z',
    });

    // Exactement ce que fait le service worker : POST sans cookie, jeton en Bearer.
    const ingest = await request(app).post('/api/ingest')
      .set({ Authorization: `Bearer ${created.token}` })
      .send(payload);
    expect(ingest.status).toBe(201);

    const { body } = await agent.get('/api/portfolio');
    expect(Number(body.snapshot.total_value_eur)).toBe(11105);
    expect(Number(body.snapshot.cash_eur)).toBe(500);

    const nvda = body.positions.find((p) => p.isin === 'US67066G1040');
    expect(Number(nvda.qty)).toBe(10);
    expect(Number(nvda.value_eur)).toBe(1105);
    expect(Number(nvda.pl_eur)).toBe(105);
    expect(nvda.currency).toBe('USD');

    const iwda = body.positions.find((p) => p.isin === 'IE00B4L5Y983');
    expect(iwda.product_type).toBe('ETF');
    expect(Number(iwda.value_eur)).toBe(9500);

    // La ligne soldée ne doit pas ressusciter dans le portefeuille.
    expect(body.positions).toHaveLength(2);
  });

  it('deux captures le même jour : la seconde remplace, sans doubler', async () => {
    const agent = request.agent(app);
    const link = await agent.post('/api/auth/request-link').send({ email: 'ext-e2e2@example.com' });
    await agent.post('/api/auth/verify').send({ token: new URL(link.body.devLink).searchParams.get('token') });
    const { body: created } = await agent.post('/api/auth/me/tokens').send({ label: 'Chrome' });
    const auth = { Authorization: `Bearer ${created.token}` };

    const first = buildPayload({ update, products: productsInfo, captureId: 'capture-1', capturedAt: '2026-07-25T09:00:00Z' });
    await request(app).post('/api/ingest').set(auth).send(first.payload);

    // Le cours a bougé dans la journée : nouvelle capture, nouvel identifiant.
    const later = structuredClone(update);
    later.portfolio.value[0].value.find((f) => f.name === 'value').value = 1200;
    later.totalPortfolio.value.find((f) => f.name === 'reportNetliq').value = 11200;
    const second = buildPayload({ update: later, products: productsInfo, captureId: 'capture-2', capturedAt: '2026-07-25T17:30:00Z' });

    const res = await request(app).post('/api/ingest').set(auth).send(second.payload);
    expect(res.status).toBe(201);

    const { body } = await agent.get('/api/portfolio');
    expect(body.positions).toHaveLength(2);
    expect(Number(body.snapshot.total_value_eur)).toBe(11200);

    // Une seule journée dans l'historique, pas deux points superposés.
    const { body: snaps } = await agent.get('/api/snapshots');
    expect(snaps.points ?? snaps.snapshots ?? snaps).toHaveLength(1);
  });

  it('rejouer la même capture ne crée rien de neuf', async () => {
    const agent = request.agent(app);
    const link = await agent.post('/api/auth/request-link').send({ email: 'ext-e2e3@example.com' });
    await agent.post('/api/auth/verify').send({ token: new URL(link.body.devLink).searchParams.get('token') });
    const { body: created } = await agent.post('/api/auth/me/tokens').send({ label: 'Chrome' });
    const auth = { Authorization: `Bearer ${created.token}` };

    const { payload } = buildPayload({ update, products: productsInfo, captureId: 'meme-capture', capturedAt: '2026-07-25T09:00:00Z' });
    const a = await request(app).post('/api/ingest').set(auth).send(payload);
    const b = await request(app).post('/api/ingest').set(auth).send(payload);

    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.deduplicated).toBe(true);
  });
});
