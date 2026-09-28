import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import { ingestSnapshot } from '../src/services/ingest.js';
import { resetDb } from './helpers.js';

createApp(); // charge la configuration et le pool comme en conditions réelles

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe('aller-retour en base des montants décimaux', () => {
  it('les colonnes DECIMAL ne reviennent pas en chaînes (sinon les additions concatènent)', async () => {
    await ingestSnapshot({
      source: 'csv',
      capture_id: 'dec-1',
      captured_at: '2026-07-01T10:00:00Z',
      total_value_eur: 1234.56,
      cash_eur: 10.5,
      positions: [{ isin: 'US0000000001', qty: 10, price: 12.3456, value_eur: 1224.06, pl_eur: -3.5 }],
    }, 1);
    const [rows] = await getPool().query('SELECT qty, price, value_eur, pl_eur FROM positions');
    const [snaps] = await getPool().query('SELECT total_value_eur, cash_eur FROM snapshots');

    // Le piège : `0 + "10.000000"` vaut "010.000000", pas 10 — un total de
    // portefeuille devenait une chaîne de chiffres collés.
    for (const k of ['qty', 'price', 'value_eur', 'pl_eur']) {
      expect(typeof rows[0][k], `${k} revient en ${typeof rows[0][k]}`).toBe('number');
    }
    expect(typeof snaps[0].total_value_eur).toBe('number');
    expect(typeof snaps[0].cash_eur).toBe('number');
    expect(rows[0].qty + rows[0].value_eur).toBeCloseTo(1234.06, 2);
  });
});
