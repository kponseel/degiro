import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import { parseCsv, mapTransactions } from '../src/services/csvParser.js';
import { saveTransactions } from '../src/services/transactions.js';
import { realizedPnl } from '../src/services/analytics.js';
import { aggregateByOrder, toTransaction } from '../../extension/src/degiro.js';
import { resetDb } from './helpers.js';

createApp(); // charge la configuration et le pool comme en conditions réelles

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

const HEADER = "Date,Heure,Produit,Code ISIN,Référence,Bourse de,Quantité,Cours,,Valeur locale,,Valeur,,Taux de change,Frais de transaction et/ou de tiers,,Total,,ID de l'ordre";

describe('exécutions partielles — import CSV', () => {
  it('fusionne les lignes qui partagent le même ID d’ordre', () => {
    // Un achat de 30 titres servi en trois fois : trois lignes, un seul ordre.
    // Avant : seule la première exécution (10 titres, 500 €) survivait au
    // dédoublonnage — 20 titres et 1 010 € disparaissaient en silence.
    const csv = [
      HEADER,
      `12-03-2021,09:05,NVIDIA CORP,US67066G1040,r1,NDQ,10,"50,00",USD,"500,00",USD,"500,00",EUR,"1,00","-1,00",EUR,"-501,00",EUR,ord-a`,
      `12-03-2021,09:06,NVIDIA CORP,US67066G1040,r1,NDQ,12,"50,10",USD,"601,20",USD,"601,20",EUR,"1,00","-0,50",EUR,"-601,70",EUR,ord-a`,
      `12-03-2021,09:07,NVIDIA CORP,US67066G1040,r1,NDQ,8,"51,00",USD,"408,00",USD,"408,00",EUR,"1,00","-0,50",EUR,"-408,50",EUR,ord-a`,
    ].join('\n');
    const txs = mapTransactions(parseCsv(csv).rows);

    expect(txs).toHaveLength(1);
    expect(txs[0].qty).toBe(30);
    expect(txs[0].amount_eur).toBeCloseTo(-1509.2, 2);
    expect(txs[0].amount).toBeCloseTo(-2, 2); // frais cumulés
    expect(txs[0].external_id).toBe('ord-a');
  });

  it('une exécution sans montant en euros rend le total inconnu — pas partiel', () => {
    const csv = [
      HEADER,
      `12-03-2021,09:05,NVIDIA CORP,US67066G1040,r1,NDQ,10,"50,00",USD,"500,00",USD,"500,00",USD,"1,00","-1,00",USD,"-501,00",USD,ord-b`,
      `12-03-2021,09:06,NVIDIA CORP,US67066G1040,r1,NDQ,12,"50,10",USD,"601,20",USD,"601,20",EUR,"1,00","-0,50",EUR,"-601,70",EUR,ord-b`,
    ].join('\n');
    const txs = mapTransactions(parseCsv(csv).rows);

    expect(txs).toHaveLength(1);
    expect(txs[0].qty).toBe(22); // la quantité, elle, est sûre
    expect(txs[0].amount_eur).toBeNull(); // 601,20 € seul serait un mensonge
  });

  it('des ordres distincts ne sont pas fusionnés', () => {
    const csv = [
      HEADER,
      `12-03-2021,09:05,NVIDIA CORP,US67066G1040,r1,NDQ,10,"50,00",USD,"500,00",USD,"500,00",EUR,"1,00","-1,00",EUR,"-501,00",EUR,ord-c`,
      `13-03-2021,09:05,NVIDIA CORP,US67066G1040,r2,NDQ,5,"51,00",USD,"255,00",USD,"255,00",EUR,"1,00","-1,00",EUR,"-256,00",EUR,ord-d`,
    ].join('\n');
    expect(mapTransactions(parseCsv(csv).rows)).toHaveLength(2);
  });
});

describe('exécutions partielles — extension (repli sans agrégation)', () => {
  const fill = (n, quantity, total, fee) => ({
    id: `t-${n}`,
    orderId: 'ord-x',
    productId: '331868',
    date: `2024-06-20T10:0${n}:00+02:00`,
    buysell: 'B',
    quantity,
    totalInBaseCurrency: total,
    feeInBaseCurrency: fee,
  });

  it('cumule quantités, montants et frais par ordre', () => {
    const rows = aggregateByOrder([fill(1, 10, -500, -1), fill(2, 12, -601.2, -0.5), fill(3, 8, -408, -0.5)]);
    expect(rows).toHaveLength(1);

    const tx = toTransaction(rows[0], { isin: 'US67066G1040', name: 'NVIDIA CORP', currency: 'USD' });
    expect(tx.qty).toBe(30);
    expect(tx.amount_eur).toBeCloseTo(-1509.2, 2);
    expect(tx.amount).toBeCloseTo(-2, 2);
    expect(tx.external_id).toBe('ord-x');
  });

  it('cumule aussi les montants en forme objet { EUR: x } — celle que DEGIRO emploie', () => {
    // Reproduit par relecture : deux exécutions en forme objet donnaient
    // qty 30 mais le montant de la SEULE première — une somme partielle
    // présentée comme complète, pire qu'une absence.
    const rows = aggregateByOrder([
      { ...fill(1, 10, undefined, undefined), totalInBaseCurrency: { EUR: -500 }, feeInBaseCurrency: { EUR: -1 } },
      { ...fill(2, 20, undefined, undefined), totalInBaseCurrency: { EUR: -1010 }, feeInBaseCurrency: { EUR: -1 } },
    ]);
    const tx = toTransaction(rows[0], { isin: 'US67066G1040', name: 'NVIDIA CORP', currency: 'USD' });
    expect(tx.qty).toBe(30);
    expect(tx.amount_eur).toBeCloseTo(-1510, 2);
    expect(tx.amount).toBeCloseTo(-2, 2);
  });

  it("une exécution sans montant rend le total de l'ordre inconnu — pas partiel", () => {
    const rows = aggregateByOrder([
      { ...fill(1, 10, undefined, -1), totalInBaseCurrency: undefined },
      fill(2, 20, -1010, -1),
    ]);
    const tx = toTransaction(rows[0], { isin: 'US67066G1040', name: 'NVIDIA CORP', currency: 'USD' });
    expect(tx.qty).toBe(30);
    expect(tx.amount_eur).toBeUndefined(); // -1010 seul serait un mensonge
  });

  it('laisse intactes les lignes déjà agrégées ou sans orderId', () => {
    const seul = { id: 't-9', orderId: 'ord-y', quantity: 5, totalInBaseCurrency: -100 };
    const sansOrdre = { id: 't-10', quantity: 3, totalInBaseCurrency: -60 };
    const rows = aggregateByOrder([seul, sansOrdre]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === 't-9').quantity).toBe(5);
  });
});

describe('exécutions partielles — réparation en base', () => {
  const ordre = (qty, eur, fee = -1) => ({
    tx_date: '2021-03-12 09:05:00',
    type: 'buy',
    isin: 'US67066G1040',
    description: 'NVIDIA CORP',
    qty,
    amount: fee,
    currency: 'EUR',
    amount_eur: eur,
    external_id: 'ord-repare',
  });

  it("un réimport agrégé remplace le fragment hérité d'une seule exécution", async () => {
    // Historique : l'ancien import ne gardait que la première exécution.
    await saveTransactions([ordre(10, -501)], 1);

    // Réimport du même CSV, désormais fusionné : l'ordre complet (30 titres).
    await saveTransactions([ordre(30, -1511.2, -2)], 1);

    const [rows] = await getPool().query(
      'SELECT qty, amount_eur, amount FROM transactions WHERE external_id = ?',
      ['ord-repare'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(30);
    expect(rows[0].amount_eur).toBe(-1511.2);
    expect(rows[0].amount).toBe(-2);
  });

  it('un montant entrant absent ne détruit jamais un montant connu', async () => {
    await saveTransactions([ordre(30, -1511.2)], 1);
    await saveTransactions([ordre(30, null)], 1);
    const [rows] = await getPool().query('SELECT amount_eur FROM transactions WHERE external_id = ?', ['ord-repare']);
    expect(rows[0].amount_eur).toBe(-1511.2);
  });

  it('bout en bout : la plus-value est juste après réparation du fragment', async () => {
    // Fragment hérité : 10 titres à 501 € (sur un ordre de 30 à 1 511,20 €),
    // puis la vente des 30. Avant réparation, le PMP était faux.
    await saveTransactions([ordre(10, -501)], 1);
    await saveTransactions([
      ordre(30, -1511.2, -2),
      { ...ordre(-30, 1800, -1), tx_date: '2024-06-20 10:00:00', type: 'sell', external_id: 'ord-vente' },
    ], 1);

    const [rows] = await getPool().query(
      'SELECT tx_date, isin, description, qty, amount, amount_eur FROM transactions ORDER BY tx_date',
    );
    const { events, totals } = realizedPnl(rows);
    expect(events).toHaveLength(1);
    // Produit net 1799 − coût (1511,20 + 2) = 285,8 €.
    expect(events[0].gain_eur).toBeCloseTo(285.8, 1);
    expect(totals.unknown).toBe(0);
  });
});

describe('garde-fou anti-régression (la plus grande quantité gagne)', () => {
  const ordre = (qty, eur, external = 'ord-garde') => ({
    tx_date: '2021-03-12 09:05:00',
    type: 'buy',
    isin: 'US67066G1040',
    description: 'NVIDIA CORP',
    qty,
    amount: -1,
    currency: 'EUR',
    amount_eur: eur,
    external_id: external,
  });

  it("un vieux CSV tronqué n'écrase pas l'ordre complet déjà en base", async () => {
    // En base : l'ordre complet (30 titres). On réimporte un export fait
    // PENDANT l'exécution, qui n'en voyait que 10 : il ne doit rien changer.
    await saveTransactions([ordre(30, -1511.2)], 1);
    await saveTransactions([ordre(10, -501)], 1);

    const [rows] = await getPool().query('SELECT qty, amount_eur FROM transactions WHERE external_id = ?', ['ord-garde']);
    expect(rows[0].qty).toBe(30);
    expect(rows[0].amount_eur).toBe(-1511.2);
  });

  it("la fenêtre de relecture de l'extension ne tronque pas un ordre à cheval sur sa borne", async () => {
    // Capture complète hier (30 titres), puis relecture incrémentale qui
    // n'attrape que la queue de l'ordre (8 titres) : la base ne bouge pas.
    await saveTransactions([ordre(30, -1511.2)], 1);
    const res = await saveTransactions([ordre(8, -408.5)], 1);

    const [rows] = await getPool().query('SELECT qty, amount_eur FROM transactions WHERE external_id = ?', ['ord-garde']);
    expect(rows[0].qty).toBe(30);
    expect(rows[0].amount_eur).toBe(-1511.2);
    expect(res.inserted).toBe(0);
  });

  it('à quantité égale, la version entrante peut toujours réparer les montants', async () => {
    await saveTransactions([{ ...ordre(30, null), amount: null }], 1);
    await saveTransactions([ordre(30, -1511.2)], 1);
    const [rows] = await getPool().query('SELECT amount_eur, amount FROM transactions WHERE external_id = ?', ['ord-garde']);
    expect(rows[0].amount_eur).toBe(-1511.2);
    expect(rows[0].amount).toBe(-1);
  });

  it('un même external_id deux fois dans un lot ne compte qu’une fois', async () => {
    const res = await saveTransactions([ordre(10, -501, 'ord-dup'), ordre(10, -501, 'ord-dup')], 1);
    expect(res.inserted).toBe(1);
  });
});
