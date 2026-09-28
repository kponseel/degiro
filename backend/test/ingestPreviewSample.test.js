import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { AUTH, resetDb } from './helpers.js';

const app = createApp();
const fixturePath = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

/**
 * Contrat de l'échantillon de prévisualisation.
 *
 * L'aperçu affiché avant confirmation (frontend/src/components/Uploader.jsx) lit
 * des champs précis. Si le mapper cesse d'en produire un, l'aperçu se viderait sans bruit — et l'utilisateur revaliderait à
 * l'aveugle, ce que cet aperçu existe précisément pour éviter.
 */
const PREVIEW_FIELDS = {
  portfolio: ['name', 'isin', 'qty', 'price', 'currency', 'value_eur'],
};

const preview = (fixture) => request(app)
  .post('/api/ingest/csv')
  .set(AUTH)
  .field('mode', 'preview')
  .attach('file', fixturePath(fixture));

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe('prévisualisation — échantillon affichable', () => {
  it.each([
    ['portfolio.csv', 'portfolio'],
    ['portfolio-real-fr.csv', 'portfolio'],
  ])('%s expose les champs que l\'aperçu affiche', async (fixture, kind) => {
    const res = await preview(fixture);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe(kind);
    expect(Array.isArray(res.body.sample)).toBe(true);
    expect(res.body.sample.length).toBeGreaterThan(0);
    // Au moins 4 lignes montrées côté interface : l'échantillon doit en fournir
    // autant que le fichier en contient.
    expect(res.body.sample.length).toBe(Math.min(res.body.count, 25));
    for (const field of PREVIEW_FIELDS[kind]) {
      expect(res.body.sample[0]).toHaveProperty(field);
    }
  });

  it('portefeuille : les valeurs de la première ligne sont exploitables telles quelles', async () => {
    const res = await preview('portfolio.csv');
    expect(res.body.sample[0]).toMatchObject({
      isin: 'US67066G1040',
      name: 'NVIDIA CORP',
      qty: 10,
      price: 120.5,
      currency: 'USD',
      value_eur: 1050,
    });
  });
});
