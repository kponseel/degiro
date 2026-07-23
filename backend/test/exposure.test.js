import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { countryFromIsin, assetClassFromType } from '../src/services/enrich.js';
import { group } from '../src/services/exposure.js';
import { AUTH, resetDb, snapshotPayload } from './helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe('helpers d\'enrichissement', () => {
  it('déduit le pays du préfixe ISIN', () => {
    expect(countryFromIsin('US67066G1040')).toBe('États-Unis');
    expect(countryFromIsin('IE00B4L5Y983')).toBe('Irlande');
    expect(countryFromIsin('NL0010273215')).toBe('Pays-Bas');
    expect(countryFromIsin('XX000000000X')).toBeNull();
  });
  it('déduit la classe d\'actifs du type DEGIRO', () => {
    expect(assetClassFromType('ETF')).toBe('ETF');
    expect(assetClassFromType('STOCK')).toBe('Action');
    expect(assetClassFromType(null)).toBeNull();
  });
});

describe('group()', () => {
  it('pondère par valeur et trie décroissant', () => {
    const g = group(
      [{ value_eur: 30, k: 'A' }, { value_eur: 70, k: 'B' }],
      (p) => p.k,
    );
    expect(g[0].key).toBe('B');
    expect(g[0].weight).toBeCloseTo(0.7, 5);
  });
  it('ignore les clés nulles avec skipNull', () => {
    const g = group([{ value_eur: 10, k: null }, { value_eur: 10, k: 'X' }], (p) => p.k, { skipNull: true });
    expect(g).toHaveLength(1);
    expect(g[0].key).toBe('X');
  });
});

describe('enrichissement + exposition (endpoints)', () => {
  it('enrichit puis expose pays et classe d\'actifs', async () => {
    await request(app).post('/api/ingest').set(AUTH).send(snapshotPayload());
    const enr = await request(app).post('/api/enrich').set(AUTH);
    expect(enr.status).toBe(200);
    expect(enr.body.enriched).toBe(2);

    const exp = await request(app).get('/api/exposure').set(AUTH);
    expect(exp.status).toBe(200);
    const countries = exp.body.country.map((c) => c.key);
    expect(countries).toContain('États-Unis');
    expect(countries).toContain('Irlande');
    // devise : EUR (IWDA 9500) domine USD (NVDA 1050)
    expect(exp.body.currency[0].key).toBe('EUR');
    // classe d'actifs issue du type DEGIRO
    expect(exp.body.asset_class.map((a) => a.key).sort()).toEqual(['Action', 'ETF']);
  });

  it('la correction manuelle prime et survit au ré-enrichissement', async () => {
    await request(app).post('/api/ingest').set(AUTH).send(snapshotPayload());
    await request(app).post('/api/enrich').set(AUTH);

    const put = await request(app)
      .put('/api/isin-ref/US67066G1040')
      .set(AUTH)
      .send({ sector: 'Technologie', country: 'États-Unis' });
    expect(put.status).toBe(200);

    await request(app).post('/api/enrich').set(AUTH); // ne doit pas écraser le manuel

    const refs = await request(app).get('/api/isin-ref').set(AUTH);
    const nvda = refs.body.refs.find((r) => r.isin === 'US67066G1040');
    expect(nvda.sector).toBe('Technologie');
    expect(nvda.manual_override).toBe(1);

    const exp = await request(app).get('/api/exposure').set(AUTH);
    expect(exp.body.sector.map((s) => s.key)).toContain('Technologie');
  });

  it('refuse un ISIN invalide en correction manuelle', async () => {
    const res = await request(app).put('/api/isin-ref/INVALID').set(AUTH).send({ sector: 'X' });
    expect(res.status).toBe(400);
  });
});
