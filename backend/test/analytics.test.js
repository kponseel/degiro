import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { attribution, concentration, riskMetrics, realizedPnl } from '../src/services/analytics.js';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import { saveTransactions } from '../src/services/transactions.js';
import { AUTH, resetDb } from './helpers.js';

const app = createApp();
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closePool(); });

describe('attribution par titre', () => {
  const positions = [
    { isin: 'US1', name: 'Gagnant', sector: 'Tech', currency: 'USD', value_eur: 1200, pl_eur: 200 },
    { isin: 'US2', name: 'Perdant', sector: 'Tech', currency: 'USD', value_eur: 800, pl_eur: -100 },
    { isin: 'FR1', name: 'Neutre', sector: 'Santé', currency: 'EUR', value_eur: 1000, pl_eur: 0 },
  ];

  it('calcule poids, rendement, contribution', () => {
    const { rows, totals } = attribution(positions);
    expect(totals.value_eur).toBe(3000);
    expect(totals.pl_eur).toBe(100); // 200 - 100 + 0

    const g = rows.find((r) => r.isin === 'US1');
    expect(g.weight).toBe(0.4);           // 1200/3000
    expect(g.pl_pct).toBe(0.2);           // 200 / (1200-200)
    expect(g.contribution).toBe(2);       // 200 / 100 total → 200 %

    const p = rows.find((r) => r.isin === 'US2');
    expect(p.pl_pct).toBeCloseTo(-100 / 900, 4);
    expect(p.contribution).toBe(-1);      // -100 / 100
  });

  it('trie du plus gros gain au plus gros perdant', () => {
    const { rows } = attribution(positions);
    expect(rows.map((r) => r.isin)).toEqual(['US1', 'FR1', 'US2']);
  });

  it('gère l’absence de P/L (null) sans planter', () => {
    const { rows, totals } = attribution([{ isin: 'X', name: 'X', value_eur: 500, pl_eur: null }]);
    expect(rows[0].pl_eur).toBeNull();
    expect(rows[0].pl_pct).toBeNull();
    expect(rows[0].contribution).toBeNull();
    expect(totals.value_eur).toBe(500);
  });

  it('rattache les dividendes par ISIN', () => {
    const divs = new Map([['US1', 34.5], ['FR1', 12]]);
    const { rows, totals } = attribution(positions, divs);
    expect(rows.find((r) => r.isin === 'US1').dividends_eur).toBe(34.5);
    expect(rows.find((r) => r.isin === 'US2').dividends_eur).toBeNull();
    expect(totals.dividends_eur).toBe(46.5);
  });
});

describe('concentration', () => {
  it('top-1, top-5, HHI et lignes effectives', () => {
    const c = concentration([0.4, 0.3, 0.2, 0.1]);
    expect(c.top1).toBe(0.4);
    expect(c.top5).toBe(1);
    expect(c.hhi).toBeCloseTo(0.3, 4); // 0.16+0.09+0.04+0.01
    expect(c.effectiveHoldings).toBeCloseTo(3.3, 1);
    expect(c.lines).toBe(4);
  });

  it('portefeuille équipondéré → lignes effectives = nombre de lignes', () => {
    const c = concentration([0.25, 0.25, 0.25, 0.25]);
    expect(c.effectiveHoldings).toBe(4);
  });

  it('une seule ligne dominante → très concentré', () => {
    const c = concentration([0.9, 0.05, 0.05]);
    expect(c.effectiveHoldings).toBeLessThan(1.3);
  });

  it('vide → zéros, sans division par zéro', () => {
    expect(concentration([])).toEqual({ top1: 0, top5: 0, hhi: 0, effectiveHoldings: 0, lines: 0 });
  });
});

describe('métriques de risque', () => {
  it('null si trop peu de points', () => {
    expect(riskMetrics([{ date: 'a', twr: 0 }])).toBeNull();
    expect(riskMetrics([{ date: 'a', twr: 0 }, { date: 'b', twr: 0.1 }])).toBeNull();
  });

  it('drawdown : capte la plus forte baisse depuis un sommet', () => {
    // Monte à +20 %, retombe à +5 % : drawdown = (1.05/1.20 - 1) ≈ -12,5 %.
    const series = [
      { date: '1', twr: 0 }, { date: '2', twr: 0.2 }, { date: '3', twr: 0.05 }, { date: '4', twr: 0.1 },
    ];
    const m = riskMetrics(series, 252);
    expect(m.maxDrawdown).toBeCloseTo(1.05 / 1.20 - 1, 3);
    expect(m.bestPeriod).toBeCloseTo(0.2, 3);      // +20 % au 1er pas
    expect(m.worstPeriod).toBeCloseTo(1.05 / 1.20 - 1, 3);
    expect(m.volatility).toBeGreaterThan(0);
    expect(m.periods).toBe(3);
  });

  it('courbe monotone croissante → drawdown nul', () => {
    const series = [{ date: '1', twr: 0 }, { date: '2', twr: 0.05 }, { date: '3', twr: 0.1 }, { date: '4', twr: 0.15 }];
    expect(riskMetrics(series).maxDrawdown).toBe(0);
  });
});

describe('plus-values réalisées (PMP)', () => {
  it('vente partielle : gain = produit − coût moyen × quantité', () => {
    const { events, totals } = realizedPnl([
      { tx_date: '2024-01-01', isin: 'A', description: 'Titre A', qty: 10, amount_eur: -1000, amount: 0 },
      { tx_date: '2024-06-01', isin: 'A', description: 'Titre A', qty: -4, amount_eur: 600, amount: 0 },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].qty).toBe(4);
    expect(events[0].cost_eur).toBe(400);      // 100 × 4
    expect(events[0].proceeds_eur).toBe(600);
    expect(events[0].gain_eur).toBe(200);      // 600 − 400
    expect(events[0].costUnknown).toBe(false);
    expect(totals.net).toBe(200);
    expect(totals.gains).toBe(200);
    expect(totals.losses).toBe(0);
    expect(totals.sales).toBe(1);
  });

  it('deux achats → coût moyen pondéré', () => {
    const { events } = realizedPnl([
      { tx_date: '2024-01-01', isin: 'A', qty: 10, amount_eur: -1000, amount: 0 },
      { tx_date: '2024-02-01', isin: 'A', qty: 10, amount_eur: -2000, amount: 0 },
      { tx_date: '2024-03-01', isin: 'A', qty: -5, amount_eur: 1000, amount: 0 },
    ]);
    // Coût moyen = (1000 + 2000) / 20 = 150 → coût cédé = 750, gain = 250.
    expect(events[0].cost_eur).toBe(750);
    expect(events[0].gain_eur).toBe(250);
  });

  it('les frais entrent au coût à l’achat et sont retranchés à la vente', () => {
    const { events } = realizedPnl([
      { tx_date: '2024-01-01', isin: 'A', qty: 10, amount_eur: -1000, amount: -5 },
      { tx_date: '2024-06-01', isin: 'A', qty: -10, amount_eur: 1200, amount: -5 },
    ]);
    expect(events[0].cost_eur).toBe(1005);     // 1000 + 5 de frais
    expect(events[0].proceeds_eur).toBe(1195); // 1200 − 5 de frais
    expect(events[0].gain_eur).toBe(190);
  });

  it('vente à perte : comptée dans les pertes', () => {
    const { totals } = realizedPnl([
      { tx_date: '2024-01-01', isin: 'A', qty: 10, amount_eur: -1000, amount: 0 },
      { tx_date: '2024-06-01', isin: 'A', qty: -10, amount_eur: 700, amount: 0 },
    ]);
    expect(totals.net).toBe(-300);
    expect(totals.losses).toBe(-300);
    expect(totals.gains).toBe(0);
  });

  it('vente sans achat connu → coût inconnu, gain non calculé', () => {
    const { events, totals } = realizedPnl([
      { tx_date: '2024-06-01', isin: 'A', qty: -5, amount_eur: 600, amount: 0 },
    ]);
    expect(events[0].costUnknown).toBe(true);
    expect(events[0].gain_eur).toBeNull();
    expect(events[0].cost_eur).toBeNull();
    expect(totals.unknown).toBe(1);
    expect(totals.net).toBe(0);
  });

  it('achat sans valeur EUR fiable → gain non calculé', () => {
    const { events } = realizedPnl([
      { tx_date: '2024-01-01', isin: 'A', qty: 10, amount_eur: null, amount: 0 },
      { tx_date: '2024-06-01', isin: 'A', qty: -5, amount_eur: 600, amount: 0 },
    ]);
    expect(events[0].costUnknown).toBe(true);
    expect(events[0].gain_eur).toBeNull();
  });

  it('agrège par ISIN et trie du plus gros gain au plus gros', () => {
    const { byIsin } = realizedPnl([
      { tx_date: '2024-01-01', isin: 'A', description: 'A', qty: 10, amount_eur: -1000, amount: 0 },
      { tx_date: '2024-06-01', isin: 'A', description: 'A', qty: -10, amount_eur: 1300, amount: 0 },
      { tx_date: '2024-01-01', isin: 'B', description: 'B', qty: 10, amount_eur: -1000, amount: 0 },
      { tx_date: '2024-06-01', isin: 'B', description: 'B', qty: -10, amount_eur: 1100, amount: 0 },
    ]);
    expect(byIsin.map((b) => b.isin)).toEqual(['A', 'B']); // +300 avant +100
    expect(byIsin[0].gain_eur).toBe(300);
    expect(byIsin[1].gain_eur).toBe(100);
  });

  it('respecte l’ordre chronologique même si les lignes arrivent mélangées', () => {
    const { events } = realizedPnl([
      { tx_date: '2024-06-01', isin: 'A', qty: -5, amount_eur: 800, amount: 0 },
      { tx_date: '2024-01-01', isin: 'A', qty: 10, amount_eur: -1000, amount: 0 },
    ]);
    // Trié : l'achat est traité avant la vente → coût connu, gain = 800 − 500.
    expect(events[0].costUnknown).toBe(false);
    expect(events[0].gain_eur).toBe(300);
  });
});

describe('GET /api/analytics', () => {
  it('exige une authentification', async () => {
    expect((await request(app).get('/api/analytics')).status).toBe(401);
  });

  it('renvoie attribution, concentration et risque pour un portefeuille importé', async () => {
    const agent = request.agent(app);
    const link = await agent.post('/api/auth/request-link').send({ email: 'analytics@example.com' });
    await agent.post('/api/auth/verify').send({ token: new URL(link.body.devLink).searchParams.get('token') });
    const { body: tok } = await agent.post('/api/auth/me/tokens').send({ label: 't' });
    const auth = { Authorization: `Bearer ${tok.token}` };

    await request(app).post('/api/ingest').set(auth).send({
      source: 'extension', capture_id: 'a1', captured_at: '2026-07-26T09:00:00Z', total_value_eur: 2000,
      positions: [
        { isin: 'US67066G1040', name: 'NVIDIA', product_type: 'STOCK', value_eur: 1200, pl_eur: 200 },
        { isin: 'IE00B4L5Y983', name: 'IWDA', product_type: 'ETF', value_eur: 800, pl_eur: -50 },
      ],
    });

    const { body } = await agent.get('/api/analytics');
    expect(body.hasPl).toBe(true);
    expect(body.attribution.rows).toHaveLength(2);
    expect(body.attribution.rows[0].isin).toBe('US67066G1040'); // plus gros gain d'abord
    expect(body.attribution.totals.pl_eur).toBe(150);
    expect(body.concentration.lines).toBe(2);
    expect(body.concentration.top1).toBeCloseTo(0.6, 2);
  });

  it('inclut les plus-values réalisées datées et les dividendes', async () => {
    await getPool().query(
      `INSERT INTO transactions (account_id, tx_date, type, isin, description, qty, amount, currency, amount_eur, external_id)
       VALUES
        (1, '2023-03-01 10:00:00', 'buy',  'US67066G1040', 'NVIDIA', 10,  0, 'EUR', -1000, 'b1'),
        (1, '2024-05-01 10:00:00', 'sell', 'US67066G1040', 'NVIDIA', -10, 0, 'EUR',  1600, 's1'),
        (1, '2024-09-01 10:00:00', 'dividend', 'IE00B4L5Y983', 'IWDA', NULL, 25, 'EUR', 25, 'd1')`,
    );
    const { body } = await request(app).get('/api/analytics').set(AUTH);
    expect(body.realized.totals.net).toBe(600);
    expect(body.realized.events).toHaveLength(1);
    expect(body.realized.events[0].date).toBe('2024-05-01');
    expect(body.realized.events[0].gain_eur).toBe(600);
    expect(body.realized.dividends).toHaveLength(1);
    expect(body.realized.dividendsTotal).toBe(25);
    // Seules les années avec activité réalisée (vente ou dividende) sont listées.
    expect(body.realized.years).toEqual(['2024']);
  });
});

describe('diagnostic des données sources du réalisé', () => {
  it('compte les ordres, les montants manquants et les doublons présumés', async () => {
    await resetDb();
    const ordre = (external, qty, eur, date = '2024-03-01 10:00:00') => ({
      tx_date: date,
      type: qty < 0 ? 'sell' : 'buy',
      isin: 'US67066G1040',
      description: 'NVIDIA CORP',
      qty,
      amount: -1,
      currency: 'EUR',
      amount_eur: eur,
      external_id: external,
    });
    await saveTransactions([
      ordre('src-1', 10, -1000, '2021-01-05 09:00:00'),
      ordre('src-2', 5, null, '2022-06-01 09:00:00'),      // montant manquant
      // Doublon présumé : même titre, même jour, même quantité, deux identifiants
      // — le vecteur réel est un import ancien à identifiant reconstruit + une
      // capture d'extension à identifiant d'ordre.
      ordre('src-3', -8, 900, '2024-03-01 10:00:00'),
      ordre('src-4', -8, 900, '2024-03-01 15:00:00'),
    ], 1);

    const { body } = await request(app).get('/api/analytics').set(AUTH);
    const s = body.realized.sources;
    expect(s.orders).toBe(4);
    expect(s.buys).toBe(2);
    expect(s.sells).toBe(2);
    expect(s.noEur).toBe(1);
    expect(s.buysNoEur).toBe(1);
    expect(s.oldest).toBe('2021-01-05');
    expect(s.newest).toBe('2024-03-01');
    expect(s.suspectDuplicates).toBe(1);
    expect(s.duplicateSamples[0]).toMatchObject({ isin: 'US67066G1040', qty: -8, n: 2 });
  });

  it('un jeu de données sain ne signale rien', async () => {
    await resetDb();
    await saveTransactions([
      { tx_date: '2021-01-05 09:00:00', type: 'buy', isin: 'US67066G1040', description: 'NVIDIA', qty: 10, amount: -1, currency: 'EUR', amount_eur: -1000, external_id: 'sain-1' },
      { tx_date: '2024-01-05 09:00:00', type: 'sell', isin: 'US67066G1040', description: 'NVIDIA', qty: -10, amount: -1, currency: 'EUR', amount_eur: 1500, external_id: 'sain-2' },
    ], 1);
    const { body } = await request(app).get('/api/analytics').set(AUTH);
    expect(body.realized.sources.noEur).toBe(0);
    expect(body.realized.sources.suspectDuplicates).toBe(0);
    expect(body.realized.totals.net).toBeGreaterThan(0);
  });
});
