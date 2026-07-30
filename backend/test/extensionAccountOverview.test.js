import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import {
  mapCashMovements, cashRanges, cashWindow, cashNextState, captureCash, cashProductIds, cashDate,
  cashFloorFromOrders,
} from '../../extension/src/cash.js';
import { buildPayload } from '../../extension/src/degiro.js';
import { classifyDescription, parseCsv, mapAccount } from '../src/services/csvParser.js';
import { saveTransactions } from '../src/services/transactions.js';
import { computeRealized } from '../src/services/analytics.js';
import { resetDb } from './helpers.js';

const app = createApp();

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closePool(); });

/**
 * Capture du relevé de compte par l'extension (accountoverview v6) : ce qui
 * remplace l'export manuel d'un Account.csv. Le risque n°1 n'est pas la lecture
 * mais le DOUBLON avec un relevé déjà importé — versements comptés deux fois,
 * donc TWR faux et dividendes gonflés.
 */

const mouvement = (over = {}) => ({
  date: '2026-07-29T13:00:24+02:00',
  valueDate: '2026-07-29T00:00:00+02:00',
  id: 987654321,
  productId: null,
  type: 'CASH_TRANSACTION',
  description: 'Versement de fonds',
  currency: 'EUR',
  change: 1000,
  balance: { EUR: 4055.22 },
  ...over,
});

describe('lecture des mouvements', () => {
  it('normalise date, montant, devise et identifiant DEGIRO', () => {
    const [m] = mapCashMovements([mouvement()]);
    expect(m.tx_date).toBe('2026-07-29 13:00:24');
    expect(m.amount).toBe(1000);
    expect(m.currency).toBe('EUR');
    expect(m.amount_eur).toBe(1000);
    expect(m.qty).toBeNull();
    expect(m.external_id).toBe('dgx-cash-987654321');
  });

  it('exclut les jambes de trésorerie des ORDRES — sinon comptées deux fois', () => {
    // Les achats/ventes viennent de l'historique des ordres, avec leur quantité
    // et leurs frais. Les reprendre ici doublerait chaque opération.
    const rows = mapCashMovements([
      mouvement({ type: 'TRANSACTION', description: 'Achat 5 ACME@119,34 USD', change: -527.75 }),
      mouvement({ type: 'CASH_TRANSACTION', id: 2, description: 'Dividende', change: 12 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('Dividende');
  });

  it('garde les types inconnus : perdre un dividende coûte plus cher qu’un « autre » de trop', () => {
    const rows = mapCashMovements([mouvement({ type: 'FLATEX_CASH_SWEEP', description: 'Balance transfer' })]);
    expect(rows).toHaveLength(1);
  });

  it('ne convertit pas les devises qu’elle ne peut pas convertir', () => {
    const [m] = mapCashMovements([mouvement({ currency: 'USD', change: 25, description: 'Dividende' })]);
    expect(m.currency).toBe('USD');
    expect(m.amount_eur).toBeNull(); // le serveur signalera un dividende en devise
  });

  it('retombe sur la date de valeur quand la date manque, et écarte l’inexploitable', () => {
    expect(cashDate('2026-07-29')).toBe('2026-07-29 00:00:00');
    const rows = mapCashMovements([
      mouvement({ date: null, valueDate: '2026-07-29' }),
      mouvement({ id: 5, date: null, valueDate: null }), // sans date : inclassable
      mouvement({ id: 6, change: undefined }), // sans montant : inexploitable
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tx_date).toBe('2026-07-29 00:00:00');
  });

  it('suffixe deux mouvements sans identifiant par ailleurs identiques', () => {
    const rows = mapCashMovements([
      mouvement({ id: null, description: 'Frais', change: -1 }),
      mouvement({ id: null, description: 'Frais', change: -1 }),
    ]);
    expect(new Set(rows.map((r) => r.external_id)).size).toBe(2);
    expect(rows[1].external_id.endsWith('#2')).toBe(true);
  });

  it('expose les identifiants produit à résoudre en ISIN', () => {
    const rows = mapCashMovements([mouvement({ productId: 331868 }), mouvement({ id: 2, productId: null })]);
    expect(cashProductIds(rows)).toEqual(['331868']);
  });
});

describe('découpage des périodes (DEGIRO plafonne la largeur de plage)', () => {
  it('découpe en fenêtres de 180 jours au plus, sans trou ni recouvrement', () => {
    const ranges = cashRanges(new Date(2025, 0, 1), new Date(2026, 6, 29));
    expect(ranges.length).toBeGreaterThan(2);
    expect(ranges[0].du).toBe('01/01/2025');
    expect(ranges[ranges.length - 1].au).toBe('29/07/2026');
    // La fenêtre suivante démarre le lendemain de la précédente.
    const fin = ranges[0].au.split('/').reverse().join('-');
    const debut = ranges[1].du.split('/').reverse().join('-');
    expect(new Date(debut) - new Date(fin)).toBe(86400000);
  });

  it('une seule fenêtre sur une courte période, aucune sur une plage inversée', () => {
    expect(cashRanges(new Date(2026, 6, 1), new Date(2026, 6, 29))).toHaveLength(1);
    expect(cashRanges(new Date(2026, 6, 29), new Date(2026, 6, 1))).toHaveLength(0);
  });
});

describe('fenêtre de lecture et mémoire', () => {
  const today = new Date(2026, 6, 29);

  it('première capture : part du début découvert par l’historique', () => {
    const { from, since } = cashWindow({ today, state: null, floorSince: '2018-01-01' });
    expect(since).toBe('2018-01-01');
    expect(from.getFullYear()).toBe(2018);
  });

  it('sans début connu : plancher DEGIRO plutôt que rien', () => {
    const { from } = cashWindow({ today, state: null, floorSince: null, floorYear: 2013 });
    expect(from.getFullYear()).toBe(2013);
  });

  it('captures suivantes : seule la période récente, avec recouvrement', () => {
    const { from, since } = cashWindow({
      today, state: { completeSince: '2018-01-01', capturedThrough: '2026-07-28' },
    });
    expect(since).toBe('2018-01-01'); // le début couvert ne régresse pas
    expect(from.getMonth()).toBe(5); // 28/07 − 31 jours → juin
  });

  it('la mémoire n’est posée que si toutes les périodes ont répondu', () => {
    expect(cashNextState({ complete: true, since: '2018-01-01', to: today }))
      .toEqual({ completeSince: '2018-01-01', capturedThrough: '2026-07-29' });
    expect(cashNextState({ complete: false, since: '2018-01-01', to: today })).toBeNull();
  });
});

describe('plancher de lecture déduit des ordres', () => {
  it('recule d’un an avant le premier ordre — pas jusqu’au plancher DEGIRO', () => {
    // Compte ouvert en 2018 : balayer depuis 2013 coûtait dix fenêtres inutiles,
    // et une rafale de requêtes risque la limitation de débit.
    expect(cashFloorFromOrders([
      { date: '2021-03-12T09:05:00+01:00' },
      { date: '2018-06-01T10:00:00+02:00' },
    ])).toBe('2017-01-01');
  });

  it('sans ordre exploitable, garde le repli fourni', () => {
    expect(cashFloorFromOrders([], '2013-01-01')).toBe('2013-01-01');
    expect(cashFloorFromOrders([{ date: 'pas-une-date' }], null)).toBeNull();
  });
});

describe('capture best-effort', () => {
  it('dédoublonne les mouvements renvoyés sur deux fenêtres', async () => {
    const m = mouvement();
    const out = await captureCash({
      from: new Date(2025, 0, 1),
      to: new Date(2026, 6, 29),
      fetchRange: async () => ({ ok: true, rows: [m] }), // le même à chaque fenêtre
    });
    expect(out.rows).toHaveLength(1);
    expect(out.complete).toBe(true);
  });

  it('deux mouvements identiques dans la MÊME fenêtre sont deux mouvements réels', async () => {
    // Cas massif sur un relevé réel (143 sur 6 794) : deux frais à la même
    // seconde, même libellé, même montant. Les confondre en perdrait un — et
    // avec des versements, c'est la TWR qui serait faussée.
    const jumeaux = [
      { ...mouvement({ id: null, description: 'Frais de courtage', change: -1 }) },
      { ...mouvement({ id: null, description: 'Frais de courtage', change: -1 }) },
    ];
    let premiere = true;
    const out = await captureCash({
      from: new Date(2026, 6, 1),
      to: new Date(2026, 6, 29),
      fetchRange: async () => {
        const rows = premiere ? jumeaux : [];
        premiere = false;
        return { ok: true, rows };
      },
    });
    expect(out.rows).toHaveLength(2); // les deux survivent
    expect(new Set(out.rows.map((r) => r.external_id)).size).toBe(2);
    expect(out.rows.reduce((s, r) => s + r.amount, 0)).toBe(-2);
  });

  it('mais un mouvement réémis sur la fenêtre SUIVANTE reste dédoublonné', async () => {
    // Un mouvement dont la date de valeur tombe au lendemain peut être renvoyé
    // sur les deux bornes : là, c'est bien le même.
    const m = mouvement();
    const out = await captureCash({
      from: new Date(2025, 0, 1),
      to: new Date(2026, 6, 29),
      fetchRange: async () => ({ ok: true, rows: [m] }), // le même à chaque fenêtre
    });
    expect(out.rows).toHaveLength(1);
  });

  it('une fenêtre refusée ne condamne pas les autres, et empêche la mémoire', async () => {
    let n = 0;
    const out = await captureCash({
      from: new Date(2025, 0, 1),
      to: new Date(2026, 6, 29),
      fetchRange: async () => {
        n += 1;
        return n === 1 ? { ok: false, reason: 'HTTP 502' } : { ok: true, rows: [mouvement({ id: n })] };
      },
    });
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.failed).toBe(1);
    expect(out.complete).toBe(false);
    expect(out.detail).toContain('HTTP 502');
  });
});

describe('robustesse du format et signal en cas de dérive', () => {
  it('accepte un montant en chaîne — DEGIRO peut changer de format du jour au lendemain', () => {
    const [m] = mapCashMovements([mouvement({ change: '1000.00' })]);
    expect(m.amount).toBe(1000);
    const [v] = mapCashMovements([mouvement({ change: '12,50' })]);
    expect(v.amount).toBe(12.5);
  });

  it('des lignes illisibles empêchent la mémoire au lieu de passer pour un relevé vide', async () => {
    // Le pire scénario : HTTP 200, des lignes renvoyées, mais un format que le
    // mapping ne sait plus lire. Déclarer la couverture complète couperait le
    // relevé DÉFINITIVEMENT, sans le moindre signal.
    const illisible = { ...mouvement(), change: { montant: 1000 } }; // ni nombre ni chaîne
    const out = await captureCash({
      from: new Date(2026, 6, 1),
      to: new Date(2026, 6, 29),
      fetchRange: async () => ({ ok: true, rows: [illisible] }),
    });
    expect(out.rows).toHaveLength(0);
    expect(out.illisibles).toBe(1);
    expect(out.complete).toBe(false); // la capture suivante retentera
    expect(out.detail).toContain('illisibles');
  });

  it('les jambes d’ordre exclues ne comptent PAS comme illisibles', async () => {
    const out = await captureCash({
      from: new Date(2026, 6, 1),
      to: new Date(2026, 6, 29),
      fetchRange: async () => ({ ok: true, rows: [mouvement({ type: 'TRANSACTION' })] }),
    });
    expect(out.rows).toHaveLength(0);
    expect(out.illisibles).toBe(0);
    expect(out.complete).toBe(true); // exclusion volontaire, pas une dérive
  });
});

describe('classification : une seule table, côté serveur', () => {
  it('l’extension n’embarque aucune table — le serveur tranche depuis le libellé', () => {
    // Le type émis par l'extension est volontairement provisoire.
    const [m] = mapCashMovements([mouvement({ description: 'Dividende' })]);
    expect(m.type).toBe('other');
    // C'est la table du serveur, la même que pour l'import CSV, qui décide.
    expect(classifyDescription('Dividende')).toBe('dividend');
    expect(classifyDescription('Versement de fonds')).toBe('deposit');
    expect(classifyDescription('Retenue à la source')).toBe('tax');
    expect(classifyDescription('Frais de courtage')).toBe('fee');
  });

  it('l’ingestion reclasse les mouvements de l’extension comme ceux du CSV', async () => {
    const { app, token } = await comptePourExtension();
    const res = await postIngest(app, token, [
      { ...mapCashMovements([mouvement({ description: 'Versement de fonds' })])[0], isin: null },
      { ...mapCashMovements([mouvement({ id: 2, description: 'Dividende ACME', change: 12 })])[0], isin: null },
    ]);
    expect(res.status).toBe(201);
    const [rows] = await getPool().query(
      "SELECT type FROM transactions WHERE external_id LIKE 'dgx-cash-%' ORDER BY amount DESC",
    );
    expect(rows.map((r) => r.type)).toEqual(['deposit', 'dividend']);
  });
});

// ── Le cœur du sujet : pas de doublon avec un Account.csv ─────────────

const RELEVE = [
  'Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id',
  '29-07-2026,13:00,29-07-2026,,,"Versement de fonds",,EUR,"1000,00",EUR,"4055,22",',
  '29-07-2026,14:00,29-07-2026,ACME CORP,US0000000001,"Dividende",,EUR,"12,00",EUR,"4067,22",',
].join('\n');

/** Les mêmes deux mouvements, vus par l'extension (identifiants DEGIRO). */
const VIA_EXTENSION = () => mapCashMovements([
  mouvement({ id: 111, description: 'Versement de fonds', change: 1000 }),
  mouvement({
    id: 222, date: '2026-07-29T14:00:00+02:00', description: 'Dividende', change: 12, productId: 331868,
  }),
]).map((m) => ({ ...m, isin: m.productId === '331868' ? 'US0000000001' : null, productId: undefined }));

/** Reclassement serveur, tel que la route d'ingestion l'applique. */
const reclasse = (txs) => txs.map((t) => (t.qty == null && t.description
  ? { ...t, type: classifyDescription(t.description) } : t));

describe('doublons entre relevé importé et relevé capturé', () => {
  it('la capture retire les jumeaux reconstruits de l’import CSV', async () => {
    await saveTransactions(mapAccount(parseCsv(RELEVE).rows), 1);
    const avant = await computeRealized(1);
    expect(avant.dividendsTotal).toBe(12);

    const res = await saveTransactions(reclasse(VIA_EXTENSION()), 1);
    expect(res.cleaned).toBe(2); // les deux acc- ont disparu

    const [rows] = await getPool().query(
      'SELECT external_id, type, amount FROM transactions WHERE account_id = 1 ORDER BY amount DESC',
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.external_id.startsWith('dgx-cash-'))).toBe(true);
    // Et surtout : les montants ne sont pas comptés deux fois.
    const apres = await computeRealized(1);
    expect(apres.dividendsTotal).toBe(12);
  });

  it('le réimport du CSV après une capture ne recrée pas de jumeau', async () => {
    await saveTransactions(reclasse(VIA_EXTENSION()), 1);
    const res = await saveTransactions(mapAccount(parseCsv(RELEVE).rows), 1);
    expect(res.inserted).toBe(0);

    const [rows] = await getPool().query('SELECT external_id FROM transactions WHERE account_id = 1');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.external_id.startsWith('dgx-cash-'))).toBe(true);
    const { dividendsTotal } = await computeRealized(1);
    expect(dividendsTotal).toBe(12);
  });

  it('les versements ne sont comptés qu’une fois — la TWR en dépend', async () => {
    await saveTransactions(mapAccount(parseCsv(RELEVE).rows), 1);
    await saveTransactions(reclasse(VIA_EXTENSION()), 1);
    const [[{ total }]] = await getPool().query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE account_id = 1 AND type = 'deposit'",
    );
    expect(Number(total)).toBe(1000);
  });

  it('deux captures de suite sont idempotentes', async () => {
    const premier = await saveTransactions(reclasse(VIA_EXTENSION()), 1);
    const second = await saveTransactions(reclasse(VIA_EXTENSION()), 1);
    expect(premier.inserted).toBe(2);
    expect(second.inserted).toBe(0);
    expect(second.cleaned).toBe(0);
  });

  it('un ISIN non résolu par l’extension n’empêche pas de reconnaître le jumeau', async () => {
    // products/info peut tomber : le dividende arrive alors sans ISIN, alors que
    // la ligne du CSV en a un. Ce n'est pas un mouvement différent.
    await saveTransactions(mapAccount(parseCsv(RELEVE).rows), 1);
    const sansIsin = VIA_EXTENSION().map((m) => ({ ...m, isin: null }));
    const res = await saveTransactions(reclasse(sansIsin), 1);
    expect(res.cleaned).toBe(2);
    const [rows] = await getPool().query('SELECT external_id FROM transactions WHERE account_id = 1');
    expect(rows).toHaveLength(2);
  });

  it('l’ISIN du jumeau importé est RÉCUPÉRÉ, pas perdu avec lui', async () => {
    // L'identifiant DEGIRO fait foi, mais la ligne importée peut être mieux
    // renseignée. Détruire l'ISIN au motif qu'on a un meilleur identifiant
    // détacherait le dividende de son titre.
    await saveTransactions(mapAccount(parseCsv(RELEVE).rows), 1);
    const sansIsin = VIA_EXTENSION().map((m) => ({ ...m, isin: null }));
    await saveTransactions(reclasse(sansIsin), 1);

    const [rows] = await getPool().query(
      "SELECT external_id, isin FROM transactions WHERE account_id = 1 AND type = 'dividend'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].external_id.startsWith('dgx-cash-')).toBe(true); // identifiant DEGIRO retenu
    expect(rows[0].isin).toBe('US0000000001'); // …et l'ISIN de l'import conservé
  });

  it('rien n’est supprimé quand l’écriture des remplaçantes échoue', async () => {
    // La suppression intervient APRÈS l'insertion : sinon un échec d'écriture
    // laisserait l'utilisateur avec MOINS de données qu'au départ.
    await saveTransactions(mapAccount(parseCsv(RELEVE).rows), 1);
    const [avant] = await getPool().query('SELECT COUNT(*) AS n FROM transactions WHERE account_id = 1');

    // Un mouvement dont le type viole l'énumération de la colonne : l'INSERT casse.
    const casse = VIA_EXTENSION().map((m) => ({ ...m, type: 'type_inexistant_qui_casse' }));
    await expect(saveTransactions(casse, 1)).rejects.toThrow();

    const [apres] = await getPool().query('SELECT COUNT(*) AS n FROM transactions WHERE account_id = 1');
    expect(apres[0].n).toBe(avant[0].n); // les lignes importées sont intactes
  });

  it('ne confond pas deux mouvements de titres différents au même montant', async () => {
    const csv = [
      'Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id',
      '29-07-2026,14:00,29-07-2026,ACME CORP,US0000000001,"Dividende",,EUR,"12,00",EUR,"100,00",',
      '29-07-2026,14:00,29-07-2026,OTHER CORP,US0000000002,"Dividende",,EUR,"12,00",EUR,"112,00",',
    ].join('\n');
    await saveTransactions(mapAccount(parseCsv(csv).rows), 1);
    // L'extension ne remonte QUE le premier, avec son ISIN.
    const un = mapCashMovements([mouvement({ id: 333, description: 'Dividende', change: 12 })])
      .map((m) => ({ ...m, isin: 'US0000000001', productId: undefined }));
    const res = await saveTransactions(reclasse(un), 1);
    expect(res.cleaned).toBe(1); // seul le jumeau du BON titre part

    const [rows] = await getPool().query(
      'SELECT external_id, isin FROM transactions WHERE account_id = 1 ORDER BY isin',
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.isin === 'US0000000002').external_id.startsWith('acc-')).toBe(true);
  });

  it('apparie UN POUR UN : un entrant ne peut pas effacer deux jumeaux', async () => {
    // Deux frais identiques le même jour existent (relevé réel : 143 cas). Ils
    // sont bien conservés tous les deux à l'import. Si l'extension n'en remonte
    // qu'un, l'autre doit SURVIVRE — sinon la perte est silencieuse.
    const csv = [
      'Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id',
      '29-07-2026,13:00,29-07-2026,,,"Frais de courtage",,EUR,"-1,00",EUR,"100,00",',
      '29-07-2026,13:00,29-07-2026,,,"Frais de courtage",,EUR,"-1,00",EUR,"99,00",',
    ].join('\n');
    const importes = mapAccount(parseCsv(csv).rows);
    expect(importes).toHaveLength(2); // les deux sont bien distingués à l'import
    await saveTransactions(importes, 1);

    const un = mapCashMovements([mouvement({ id: 444, description: 'Frais de courtage', change: -1 })])
      .map((m) => ({ ...m, isin: null, productId: undefined }));
    const res = await saveTransactions(reclasse(un), 1);
    expect(res.cleaned).toBe(1); // un seul jumeau retiré, pas les deux

    const [rows] = await getPool().query(
      "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM transactions WHERE account_id = 1 AND type = 'fee'",
    );
    expect(rows[0].n).toBe(2); // le second frais a survécu
    expect(Number(rows[0].total)).toBe(-2);
  });

  it('reconnaît le jumeau même si le type stocké est périmé', async () => {
    // Le type d'une ligne importée est figé ; la table de classification, elle,
    // évolue. Si l'appariement se fiait au type stocké, le jumeau ne serait plus
    // reconnu et le versement compté DEUX fois — donc la TWR faussée.
    await saveTransactions([{
      tx_date: '2026-07-29 13:00:00',
      type: 'other', // classement obsolète : aujourd'hui ce libellé donne 'deposit'
      isin: null,
      description: 'Versement de fonds',
      qty: null,
      amount: 1000,
      currency: 'EUR',
      amount_eur: 1000,
      external_id: 'acc-type-perime',
    }], 1);

    const entrant = mapCashMovements([mouvement({ id: 555, description: 'Versement de fonds', change: 1000 })])
      .map((m) => ({ ...m, isin: null, productId: undefined }));
    const res = await saveTransactions(reclasse(entrant), 1);
    expect(res.cleaned).toBe(1); // le jumeau au type périmé est bien reconnu

    const [rows] = await getPool().query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE account_id = 1 AND type = 'deposit'",
    );
    expect(Number(rows[0].total)).toBe(1000); // et non 2000
  });

  it('ne touche pas aux ordres : seuls les mouvements sans quantité sont arbitrés', async () => {
    await saveTransactions([{
      tx_date: '2026-07-29 13:00:00', type: 'buy', isin: 'US0000000001', description: 'Achat',
      qty: 5, amount: -3.31, currency: 'EUR', amount_eur: -524.44, external_id: 'acc-ordre-hérité',
    }], 1);
    const res = await saveTransactions(reclasse(VIA_EXTENSION()), 1);
    expect(res.cleaned).toBe(0);
    const [rows] = await getPool().query("SELECT COUNT(*) AS n FROM transactions WHERE type = 'buy'");
    expect(rows[0].n).toBe(1);
  });
});

describe('assemblage du payload', () => {
  const update = {
    portfolio: { value: [{ value: [{ name: 'id', value: 'EUR' }, { name: 'positionType', value: 'CASH' }, { name: 'value', value: 500 }] }] },
    totalPortfolio: { value: [{ name: 'reportPortfValue', value: 0 }, { name: 'reportCashBal', value: 500 }, { name: 'reportNetliq', value: 500 }] },
  };
  const infos = [{ data: { 331868: { isin: 'US0000000001', name: 'ACME', productType: 'STOCK', currency: 'USD' } } }];

  it('joint les mouvements aux transactions et leur rattache l’ISIN', () => {
    const { payload, diagnostics } = buildPayload({
      update,
      products: infos,
      transactions: null,
      cashMovements: mapCashMovements([
        mouvement({ id: 1, productId: 331868, description: 'Dividende', change: 12 }),
        mouvement({ id: 2, description: 'Versement de fonds', change: 1000 }),
      ]),
      captureId: 'c1',
      capturedAt: '2026-07-29T13:00:00Z',
    });
    expect(payload.transactions).toHaveLength(2);
    expect(diagnostics.cashMovements).toBe(2);
    expect(payload.transactions[0].isin).toBe('US0000000001');
    // Un versement n'a pas de titre : l'absence d'ISIN ne le disqualifie pas.
    expect(payload.transactions[1].isin).toBeNull();
    // `productId` ne fait pas partie du contrat d'ingestion.
    expect(payload.transactions[0].productId).toBeUndefined();
  });

  it('sans mouvement, le payload est inchangé', () => {
    const { payload, diagnostics } = buildPayload({
      update, products: infos, transactions: null, captureId: 'c2', capturedAt: '2026-07-29T13:00:00Z',
    });
    expect(payload.transactions).toHaveLength(0);
    expect(diagnostics.cashMovements).toBe(0);
  });
});

// ── Utilitaires ──────────────────────────────────────────────────────

async function comptePourExtension() {
  const request = (await import('supertest')).default;
  const agent = request.agent(app);
  const link = await agent.post('/api/auth/request-link').send({ email: 'cash@example.com' });
  await agent.post('/api/auth/verify').send({ token: new URL(link.body.devLink).searchParams.get('token') });
  const { body } = await agent.post('/api/auth/me/tokens').send({ label: 'Chrome' });
  return { app, token: body.token };
}

async function postIngest(app, token, transactions) {
  const request = (await import('supertest')).default;
  return request(app).post('/api/ingest').set('Authorization', `Bearer ${token}`).send({
    schema_version: 1,
    source: 'extension',
    capture_id: `cap-${Math.abs(transactions.length)}-${transactions[0].external_id}`.slice(0, 36),
    captured_at: '2026-07-29T13:00:00Z',
    positions: [],
    transactions,
  });
}
