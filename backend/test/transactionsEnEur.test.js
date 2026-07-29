import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import { parseCsv, mapTransactions, mapAccount, detectKind } from '../src/services/csvParser.js';
import { saveTransactions } from '../src/services/transactions.js';
import { realizedPnl, computeRealized } from '../src/services/analytics.js';
import { resetDb } from './helpers.js';

createApp(); // charge la configuration et le pool comme en conditions réelles

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

/**
 * Format RÉEL de l'export anglais récent (constaté sur un fichier de
 * production) : la devise est DANS l'en-tête (« Value EUR », « Total EUR »),
 * une colonne « AutoFX Fee » s'ajoute aux frais, et la colonne « Order ID »
 * est VIDE — l'UUID vit dans la colonne sans titre qui la suit.
 */
const HEADER = 'Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID,';

const ACHAT = '12-03-2021,09:05,ACME CORP,US0000000001,NDQ,MSRP,5,"119,3400",USD,"-596,70",USD,"-524,44","1,1378","-1,31","-2,00","-527,75",,993ae5df-7ad1-438c-9ba7-1b85c4958690';
const VENTE = '28-07-2026,16:39,ACME CORP,US0000000001,NDQ,BATS,-4,"319,0000",USD,"1276,00",USD,"1121,57","1,1377","-2,80","-2,00","1116,76",,39e444b5-8f9d-40e0-a475-3dda3f6cfbb2';

describe('export anglais « Value EUR » — le format qui laissait tout à nul', () => {
  it('détecte le type et lit montants, frais (AutoFX compris) et UUID décalé', () => {
    const { rows } = parseCsv([HEADER, ACHAT, VENTE].join('\n'));
    expect(detectKind(rows)).toBe('transactions');
    const txs = mapTransactions(rows);
    expect(txs).toHaveLength(2);

    const achat = txs.find((t) => t.type === 'buy');
    expect(achat.qty).toBe(5);
    // « Value EUR » : le montant brut, directement en euros dans la colonne.
    expect(achat.amount_eur).toBeCloseTo(-524.44, 2);
    // Frais de transaction + frais AutoFX (conversion de devise).
    expect(achat.amount).toBeCloseTo(-3.31, 2);
    // L'UUID est dans la colonne SANS TITRE après « Order ID » (vide).
    expect(achat.external_id).toBe('993ae5df-7ad1-438c-9ba7-1b85c4958690');

    const vente = txs.find((t) => t.type === 'sell');
    expect(vente.qty).toBe(-4);
    expect(vente.amount_eur).toBeCloseTo(1121.57, 2);
    expect(vente.amount).toBeCloseTo(-4.8, 2);
    expect(vente.external_id).toBe('39e444b5-8f9d-40e0-a475-3dda3f6cfbb2');
  });

  it('la plus-value se calcule de bout en bout sur ce format', () => {
    const { events, totals } = realizedPnl(mapTransactions(parseCsv([HEADER, ACHAT, VENTE].join('\n')).rows));
    expect(totals.unknown).toBe(0);
    expect(events).toHaveLength(1);
    // Produit net 1121,57 − 4,80 = 1116,77 ; coût de 4/5 de (524,44 + 3,31).
    expect(events[0].gain_eur).toBeCloseTo(1116.77 - (527.75 / 5) * 4, 1);
  });
});

describe('nettoyage des jumeaux à identifiant reconstruit', () => {
  it("le réimport avec le vrai UUID retire l'ancien jumeau « tx-… »", async () => {
    // Ancien import : Order ID lu vide → identifiant reconstruit.
    await saveTransactions([{
      tx_date: '2021-03-12 09:05:00',
      type: 'buy',
      isin: 'US0000000001',
      description: 'ACME CORP',
      qty: 5,
      amount: null,
      currency: 'USD',
      amount_eur: null,
      external_id: 'tx-abcdef0123456789abcdef01',
    }], 1);

    // Réimport corrigé : même ordre, vrai UUID, montants lus.
    const res = await saveTransactions(mapTransactions(parseCsv([HEADER, ACHAT].join('\n')).rows), 1);

    const [rows] = await getPool().query(
      "SELECT external_id, qty, amount_eur FROM transactions WHERE account_id = 1 AND type = 'buy'",
    );
    expect(rows).toHaveLength(1); // le jumeau a disparu, pas de double comptage
    expect(rows[0].external_id).toBe('993ae5df-7ad1-438c-9ba7-1b85c4958690');
    expect(rows[0].amount_eur).toBeCloseTo(-524.44, 2);
    expect(res.cleaned).toBe(1);
  });

  it('ne touche pas aux mouvements du relevé de compte ni aux ordres sans coïncidence', async () => {
    await saveTransactions([
      { tx_date: '2021-03-12 09:00:00', type: 'dividend', isin: 'US0000000001', description: 'Dividende', qty: null, amount: 12, currency: 'EUR', amount_eur: 12, external_id: 'acc-1111111111111111111111' },
      { tx_date: '2021-03-12 09:05:00', type: 'buy', isin: 'US0000000001', description: 'ACME', qty: 9, amount: -1, currency: 'EUR', amount_eur: -900, external_id: 'tx-9999999999999999999999' },
    ], 1);

    const res = await saveTransactions(mapTransactions(parseCsv([HEADER, ACHAT].join('\n')).rows), 1);

    const [rows] = await getPool().query('SELECT external_id FROM transactions WHERE account_id = 1 ORDER BY external_id');
    // Le dividende (acc-) et l'ordre à quantité différente (qty 9 ≠ 5) survivent.
    expect(rows.map((r) => r.external_id)).toEqual([
      '993ae5df-7ad1-438c-9ba7-1b85c4958690',
      'acc-1111111111111111111111',
      'tx-9999999999999999999999',
    ]);
    expect(res.cleaned).toBe(0);
  });
});

describe('relevé de compte réel — collisions et dividendes en devise', () => {
  const H = 'Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id';

  it('deux mouvements identiques à la même minute ne s’écrasent plus', () => {
    // Deux jambes de frais identiques (même minute, même libellé, même montant) :
    // l'identifiant reconstruit était le même, le second mouvement disparaissait.
    const csv = [
      H,
      '28-07-2026,16:39,28-07-2026,ACME CORP,US0000000001,"Frais de courtage",,EUR,"-1,00",EUR,"100,00",',
      '28-07-2026,16:39,28-07-2026,ACME CORP,US0000000001,"Frais de courtage",,EUR,"-1,00",EUR,"99,00",',
    ].join('\n');
    const txs = mapAccount(parseCsv(csv).rows);
    expect(txs).toHaveLength(2);
    expect(new Set(txs.map((t) => t.external_id)).size).toBe(2);
    // Le premier garde l'identifiant historique : les réimports dédoublonnent
    // toujours avec l'existant.
    expect(txs[0].external_id.startsWith('acc-')).toBe(true);
    expect(txs[0].external_id.includes('#')).toBe(false);
    expect(txs[1].external_id.endsWith('#2')).toBe(true);
  });

  it('le réimport du même fichier reste idempotent malgré les suffixes', async () => {
    const csv = [
      H,
      '28-07-2026,16:39,28-07-2026,ACME CORP,US0000000001,"Frais de courtage",,EUR,"-1,00",EUR,"100,00",',
      '28-07-2026,16:39,28-07-2026,ACME CORP,US0000000001,"Frais de courtage",,EUR,"-1,00",EUR,"99,00",',
    ].join('\n');
    const txs = mapAccount(parseCsv(csv).rows);
    const premier = await saveTransactions(txs, 1);
    const second = await saveTransactions(mapAccount(parseCsv(csv).rows), 1);
    expect(premier.inserted).toBe(2);
    expect(second.inserted).toBe(0);
    const [rows] = await getPool().query("SELECT COUNT(*) AS n FROM transactions WHERE account_id = 1 AND type = 'fee'");
    expect(rows[0].n).toBe(2);
  });

  it('compte les dividendes en devise, exclus du total en euros', async () => {
    await saveTransactions([
      { tx_date: '2026-05-01 10:00:00', type: 'dividend', isin: 'US0000000001', description: 'Dividende', qty: null, amount: 10, currency: 'EUR', amount_eur: 10, external_id: 'acc-div-eur' },
      { tx_date: '2026-06-01 10:00:00', type: 'dividend', isin: 'US0000000001', description: 'Dividende', qty: null, amount: 25, currency: 'USD', amount_eur: null, external_id: 'acc-div-usd' },
    ], 1);
    const realized = await computeRealized(1);
    expect(realized.dividendsTotal).toBe(10);
    expect(realized.dividendsForeign).toBe(1); // le versement USD est signalé, pas tu
  });
});
