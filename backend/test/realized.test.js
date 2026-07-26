import { describe, it, expect } from 'vitest';
import {
  filterByPeriod, periodSummary, byYear, monthsIn, totalReturn,
} from '../../frontend/src/lib/realized.js';

const events = [
  { date: '2023-03-15', isin: 'A', gain_eur: 200, costUnknown: false },
  { date: '2023-11-02', isin: 'B', gain_eur: -80, costUnknown: false },
  { date: '2024-05-10', isin: 'A', gain_eur: 500, costUnknown: false },
  { date: '2024-06-01', isin: 'C', gain_eur: null, costUnknown: true },
];
const divs = [
  { date: '2023-04-01', isin: 'A', amount_eur: 30 },
  { date: '2024-04-01', isin: 'A', amount_eur: 45 },
];

describe('filterByPeriod', () => {
  it('sans filtre → tout', () => {
    expect(filterByPeriod(events)).toHaveLength(4);
  });
  it('filtre par année', () => {
    expect(filterByPeriod(events, { year: '2023' }).map((e) => e.isin)).toEqual(['A', 'B']);
  });
  it('filtre par mois (prioritaire sur l’année)', () => {
    expect(filterByPeriod(events, { year: '2024', month: '2024-05' })).toHaveLength(1);
  });
});

describe('periodSummary', () => {
  it('sépare gains, pertes, net et dividendes (chiffres bruts)', () => {
    const s = periodSummary(events, divs);
    expect(s.gains).toBe(700);       // 200 + 500
    expect(s.losses).toBe(-80);
    expect(s.net).toBe(620);         // 700 − 80
    expect(s.dividends).toBe(75);    // 30 + 45
    expect(s.total).toBe(695);       // 620 + 75
    expect(s.sales).toBe(4);
    expect(s.unknown).toBe(1);       // la vente au coût inconnu
  });

  it('ignore les ventes au coût inconnu dans le net', () => {
    const s = periodSummary([{ date: '2024-01-01', gain_eur: null, costUnknown: true }], []);
    expect(s.net).toBe(0);
    expect(s.sales).toBe(1);
    expect(s.unknown).toBe(1);
  });
});

describe('byYear', () => {
  it('regroupe par année, plus récente d’abord', () => {
    const rows = byYear(events, divs);
    expect(rows.map((r) => r.year)).toEqual(['2024', '2023']);
    expect(rows[0].net).toBe(500);       // 2024 : +500 (la vente inconnue ignorée)
    expect(rows[0].dividends).toBe(45);
    expect(rows[1].net).toBe(120);       // 2023 : +200 − 80
    expect(rows[1].dividends).toBe(30);
  });
});

describe('monthsIn', () => {
  it('liste les mois présents d’une année', () => {
    expect(monthsIn(events, '2023')).toEqual(['2023-03', '2023-11']);
    expect(monthsIn(events, '2024')).toEqual(['2024-05', '2024-06']);
  });
});

describe('totalReturn', () => {
  it('additionne latent + réalisé + dividendes', () => {
    const t = totalReturn({ latentPl: 1000, realizedNet: 620, dividends: 75 });
    expect(t.total).toBe(1695);
    expect(t.partial).toBe(false);
  });
  it('marque le retour partiel si le latent manque', () => {
    const t = totalReturn({ latentPl: null, realizedNet: 620, dividends: 75 });
    expect(t.total).toBe(695);
    expect(t.partial).toBe(true);
  });
});
