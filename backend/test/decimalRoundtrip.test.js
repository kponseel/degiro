import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import { saveTransactions } from '../src/services/transactions.js';
import { realizedPnl } from '../src/services/analytics.js';
import { resetDb } from './helpers.js';

createApp(); // charge la configuration et le pool comme en conditions réelles

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

const ordre = (date, qty, eurSigne, external) => ({
  tx_date: date,
  type: qty < 0 ? 'sell' : 'buy',
  isin: 'US67066G1040',
  description: 'NVIDIA CORP',
  qty,
  amount: -1,
  currency: 'EUR',
  amount_eur: eurSigne,
  external_id: external,
});

describe('aller-retour en base des montants décimaux', () => {
  it('les colonnes DECIMAL ne reviennent pas en chaînes (sinon les additions concatènent)', async () => {
    await saveTransactions([ordre('2021-01-01 10:00:00', 10, -1000, 'x-1')], 1);
    const [rows] = await getPool().query('SELECT qty, amount_eur, amount FROM transactions WHERE external_id = ?', ['x-1']);

    // Le piège : `0 + "10.000000"` vaut "010.000000", pas 10. Le prix moyen
    // pondéré part alors en NaN dès le deuxième achat d'une même ligne.
    expect(typeof rows[0].qty, `qty revient en ${typeof rows[0].qty}`).toBe('number');
    expect(typeof rows[0].amount_eur).toBe('number');
    expect(typeof rows[0].amount).toBe('number');
  });

  it('deux achats puis une vente donnent une plus-value juste après un aller-retour en base', async () => {
    await saveTransactions([
      ordre('2021-01-01 10:00:00', 10, -1000, 'y-1'),
      ordre('2021-06-01 10:00:00', 5, -700, 'y-2'),   // PMP = (1001 + 701) / 15
      ordre('2024-01-01 10:00:00', -15, 2400, 'y-3'),
    ], 1);
    const [rows] = await getPool().query(
      'SELECT tx_date, isin, description, qty, amount, amount_eur FROM transactions ORDER BY tx_date',
    );
    const { events, totals } = realizedPnl(rows);

    expect(events).toHaveLength(1);
    expect(Number.isFinite(events[0].gain_eur), `gain_eur = ${events[0].gain_eur}`).toBe(true);
    // Produit net 2399 − coût de revient 1702 ≈ 697
    expect(events[0].gain_eur).toBeCloseTo(697, 0);
    expect(totals.net).toBeCloseTo(697, 0);
  });
});

describe('réimport réparateur', () => {
  it('un réimport comble un amount_eur manquant sans écraser ce qui est connu', async () => {
    // État hérité : l'ordre a été importé avant que le parseur ne sache lire les
    // montants en euros. `INSERT IGNORE` rendait ce trou définitif.
    await saveTransactions([{ ...ordre('2021-01-01 10:00:00', 10, null, 'z-1'), amount_eur: null }], 1);
    let [rows] = await getPool().query('SELECT amount_eur FROM transactions WHERE external_id = ?', ['z-1']);
    expect(rows[0].amount_eur).toBeNull();

    // Même ordre, réimporté depuis un export complet : le trou doit se combler.
    const res = await saveTransactions([ordre('2021-01-01 10:00:00', 10, -1000, 'z-1')], 1);
    [rows] = await getPool().query('SELECT amount_eur, qty FROM transactions WHERE external_id = ?', ['z-1']);
    expect(rows[0].amount_eur).toBe(-1000);
    expect(res.completed).toBe(1);
    expect(res.inserted).toBe(0);

    // Et une valeur déjà connue n'est jamais remplacée par une valeur douteuse.
    await saveTransactions([{ ...ordre('2021-01-01 10:00:00', 10, -1000, 'z-1'), amount_eur: null }], 1);
    [rows] = await getPool().query('SELECT amount_eur FROM transactions WHERE external_id = ?', ['z-1']);
    expect(rows[0].amount_eur).toBe(-1000);
  });

  it('ne compte pas plus de lignes que ce qui a été envoyé', async () => {
    const res = await saveTransactions([
      ordre('2022-01-01 10:00:00', 1, -100, 'w-1'),
      ordre('2022-01-02 10:00:00', 1, -100, 'w-2'),
    ], 1);
    expect(res.received).toBe(2);
    expect(res.inserted).toBe(2);
    expect(res.completed).toBe(0);
    expect(res.inserted + res.completed).toBeLessThanOrEqual(res.received);
  });
});
