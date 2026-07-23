import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { parseHoldingsCsv } from '../src/services/etfHoldings.js';
import { AUTH, resetDb } from './helpers.js';

const app = createApp();
const fixturePath = (n) => new URL(`./fixtures/${n}`, import.meta.url).pathname;

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe('parseHoldingsCsv', () => {
  it('détecte l\'en-tête après le préambule iShares et lit les poids', () => {
    const { holdings } = parseHoldingsCsv(readFileSync(fixturePath('etf-holdings.csv')));
    expect(holdings).toHaveLength(4);
    const nvda = holdings.find((h) => h.isin === 'US67066G1040');
    expect(nvda.weight).toBeCloseTo(3.9, 2);
    expect(nvda.name).toBe('NVIDIA CORP');
  });
});

describe('look-through ETF', () => {
  async function seedPortfolioWithEtf() {
    await request(app).post('/api/ingest').set(AUTH).send({
      source: 'extension',
      capture_id: 'lt-1',
      captured_at: '2026-07-20T10:00:00Z',
      positions: [
        { isin: 'IE00B4L5Y983', name: 'iShares Core MSCI World', product_type: 'ETF', value_eur: 10000 },
        { isin: 'US67066G1040', name: 'NVIDIA CORP', product_type: 'STOCK', value_eur: 1050 },
      ],
    });
  }

  it('éclate l\'ETF et révèle la surexposition (NVDA direct + via ETF)', async () => {
    await seedPortfolioWithEtf();
    const up = await request(app)
      .post('/api/etf-holdings')
      .set(AUTH)
      .field('etf_isin', 'IE00B4L5Y983')
      .attach('file', fixturePath('etf-holdings.csv'));
    expect(up.status).toBe(200);
    expect(up.body.saved).toBe(4);

    const lt = await request(app).get('/api/lookthrough').set(AUTH);
    expect(lt.status).toBe(200);
    expect(lt.body.coveredCount).toBe(1);

    const nvda = lt.body.trueHoldings.find((h) => h.isin === 'US67066G1040');
    expect(nvda.direct).toBeCloseTo(1050, 1);
    expect(nvda.viaEtf).toBeCloseTo(390, 1); // 10000 × 3,90 %
    expect(nvda.total).toBeCloseTo(1440, 1);

    // NVDA doit apparaître comme surexposition (direct ET via ETF)
    expect(lt.body.overlaps.some((o) => o.isin === 'US67066G1040')).toBe(true);

    // Résidu de l'ETF non couvert (top-4 seulement)
    expect(lt.body.trueHoldings.some((h) => /reste/i.test(h.name))).toBe(true);
  });

  it('liste les ETF détenus et leur couverture', async () => {
    await seedPortfolioWithEtf();
    const res = await request(app).get('/api/etf-holdings').set(AUTH);
    expect(res.status).toBe(200);
    const etf = res.body.etfs.find((e) => e.isin === 'IE00B4L5Y983');
    expect(etf).toBeTruthy();
    expect(etf.covered).toBe(false);
  });

  it('exige une authentification', async () => {
    const res = await request(app).get('/api/lookthrough');
    expect(res.status).toBe(401);
  });
});
