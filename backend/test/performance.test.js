import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import {
  capitalSeries, monthlyReturns, drawdownSeries, flowCoverage,
} from '../src/services/performance.js';
import { AUTH, resetDb } from './helpers.js';

const app = createApp();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

function snap(capture_id, captured_at, total_value_eur) {
  return request(app).post('/api/ingest').set(AUTH).send({ source: 'extension', capture_id, captured_at, total_value_eur, positions: [] });
}

describe('GET /api/performance (TWR)', () => {
  it('insuffisant avec moins de 2 snapshots', async () => {
    await snap('p1', '2026-01-01T12:00:00Z', 10000);
    const res = await request(app).get('/api/performance').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.insufficient).toBe(true);
    expect(res.body.twr).toBeNull();
  });

  it('TWR = variation de valeur sans flux externe', async () => {
    await snap('p1', '2026-01-01T12:00:00Z', 10000);
    await snap('p2', '2026-02-01T12:00:00Z', 11000);
    const res = await request(app).get('/api/performance').set(AUTH);
    expect(res.body.twr).toBeCloseTo(0.1, 4); // +10 %
    expect(res.body.series).toHaveLength(2);
  });

  it('neutralise un dépôt (Dietz modifié)', async () => {
    await snap('p1', '2026-01-01T12:00:00Z', 10000);
    await snap('p2', '2026-02-01T12:00:00Z', 16000);
    // dépôt de 5000 € le 16/01 (pondération temporelle 16/31)
    await getPool().query(
      `INSERT INTO transactions (account_id, tx_date, type, amount, currency, amount_eur, external_id)
       VALUES (1, '2026-01-16 10:00:00', 'deposit', 5000, 'EUR', 5000, 'dep-1')`,
    );
    const res = await request(app).get('/api/performance').set(AUTH);
    // r = (16000-10000-5000) / (10000 + 5000*16/31) ≈ 0.0795
    expect(res.body.twr).toBeCloseTo(0.0795, 3);
    expect(res.body.flows).toBe(1);
  });

  it('exige une authentification', async () => {
    const res = await request(app).get('/api/performance');
    expect(res.status).toBe(401);
  });
});

describe('Capital investi et bénéfice', () => {
  const points = [
    { date: '2026-01-01', value: 10000 },
    { date: '2026-02-01', value: 11000 },
    { date: '2026-03-01', value: 12500 },
  ];

  it('compte les versements ANTÉRIEURS au premier snapshot', () => {
    // Le point décisif : l'argent versé avant qu'on ne commence à mesurer
    // finance toujours le portefeuille. L'oublier ferait passer 8 000 € d'apport
    // pour 8 000 € de gain.
    const serie = capitalSeries(points, [{ date: '2018-05-02', amount: 8000 }]);
    expect(serie[0]).toEqual({ date: '2026-01-01', value: 10000, invested: 8000, pnl: 2000 });
    expect(serie[2].pnl).toBe(4500);
  });

  it('suit dépôts et retraits au fil de la période', () => {
    const serie = capitalSeries(points, [
      { date: '2018-05-02', amount: 8000 },
      { date: '2026-01-15', amount: 1000 },
      { date: '2026-02-20', amount: -500 },
    ]);
    expect(serie.map((s) => s.invested)).toEqual([8000, 9000, 8500]);
    expect(serie.map((s) => s.pnl)).toEqual([2000, 2000, 4000]);
  });

  it('ignore un flux postérieur au dernier snapshot', () => {
    // Un versement fait après la dernière capture n'a encore rien financé :
    // le compter creuserait une perte fictive de son montant.
    const serie = capitalSeries(points, [{ date: '2026-06-01', amount: 5000 }]);
    expect(serie[2].invested).toBe(0);
  });

  it('survit à une absence totale de flux', () => {
    expect(capitalSeries(points, []).map((s) => s.invested)).toEqual([0, 0, 0]);
    expect(capitalSeries([], [{ date: '2020-01-01', amount: 10 }])).toEqual([]);
  });

  it('expose le capital et le bénéfice via l’API', async () => {
    await snap('p1', '2026-01-01T12:00:00Z', 10000);
    await snap('p2', '2026-02-01T12:00:00Z', 11000);
    await getPool().query(
      `INSERT INTO transactions (account_id, tx_date, type, amount, currency, amount_eur, external_id)
       VALUES (1, '2018-05-02 10:00:00', 'deposit', 8000, 'EUR', 8000, 'dep-old')`,
    );
    const res = await request(app).get('/api/performance').set(AUTH);
    expect(res.body.capital.invested).toBe(8000);
    expect(res.body.capital.pnl).toBe(3000);
    expect(res.body.capital.pnlPct).toBeCloseTo(0.375, 4);
    expect(res.body.capital.firstFlow).toBe('2018-05-02');
    expect(res.body.capital.series).toHaveLength(2);
  });

  it('donne le bénéfice dès la PREMIÈRE capture, quand le TWR ne peut rien dire', async () => {
    // Le TWR exige deux points ; le capital investi, un seul. Renvoyer un bloc
    // vide sous prétexte que le TWR est indisponible privait l'utilisateur du
    // seul chiffre calculable — et du plus parlant.
    await snap('p1', '2026-01-01T12:00:00Z', 10000);
    await getPool().query(
      `INSERT INTO transactions (account_id, tx_date, type, amount, currency, amount_eur, external_id)
       VALUES (1, '2020-01-02 10:00:00', 'deposit', 7000, 'EUR', 7000, 'dep-1')`,
    );
    const res = await request(app).get('/api/performance').set(AUTH);
    expect(res.body.insufficient).toBe(true);
    expect(res.body.capital.pnl).toBe(3000);
  });
});

describe('Couverture des versements', () => {
  it('signale un relevé qui commence après les premiers ordres', () => {
    // Capital sous-estimé ⇒ bénéfice surestimé. Mieux vaut l'avouer qu'afficher
    // un gain flatteur et faux.
    expect(flowCoverage({ firstFlow: '2024-01-01', firstTx: '2018-03-04' })).toBe('partial');
  });

  it('tolère les quelques jours entre ouverture et premier ordre', () => {
    expect(flowCoverage({ firstFlow: '2018-03-10', firstTx: '2018-03-04' })).toBe('complete');
  });

  it('distingue « aucun versement connu » d’un historique complet', () => {
    expect(flowCoverage({ firstFlow: null, firstTx: '2018-03-04' })).toBe('none');
    expect(flowCoverage({ firstFlow: '2018-03-04', firstTx: null })).toBe('complete');
  });
});

describe('Rendements mensuels et courbe sous-marine', () => {
  const serie = [
    { date: '2026-01-05', twr: 0 },
    { date: '2026-01-28', twr: 0.05 },
    { date: '2026-02-26', twr: 0.02 },
    { date: '2026-04-10', twr: 0.10 },
  ];

  it('chaîne les rendements mois par mois', () => {
    const m = monthlyReturns(serie);
    expect(m.map((x) => x.month)).toEqual(['2026-01', '2026-02', '2026-04']);
    expect(m[0].ret).toBeCloseTo(0.05, 4);
    expect(m[1].ret).toBeCloseTo(1.02 / 1.05 - 1, 4);
  });

  it('omet un mois sans capture au lieu de le dessiner à zéro', () => {
    // Mars n'a aucun point : une barre à 0 % se lirait « mois blanc », alors
    // qu'il s'agit d'un trou dans les captures.
    expect(monthlyReturns(serie).some((x) => x.month === '2026-03')).toBe(false);
  });

  it('mesure l’écart au plus haut, jamais positif', () => {
    const dd = drawdownSeries(serie);
    expect(dd.map((d) => d.dd).every((v) => v <= 0)).toBe(true);
    expect(dd[1].dd).toBe(0); // nouveau sommet
    expect(dd[2].dd).toBeCloseTo(1.02 / 1.05 - 1, 4);
    expect(dd[3].dd).toBe(0); // sommet repris
  });

  it('reste muet plutôt que faux sur une série trop courte', () => {
    expect(monthlyReturns([{ date: '2026-01-01', twr: 0 }])).toEqual([]);
    expect(monthlyReturns(null)).toEqual([]);
    expect(drawdownSeries(null)).toEqual([]);
  });
});
