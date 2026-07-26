import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { attribution, concentration, riskMetrics } from '../src/services/analytics.js';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { resetDb } from './helpers.js';

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
});
