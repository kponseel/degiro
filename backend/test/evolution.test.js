import { describe, it, expect } from 'vitest';
import { evolution } from '../../frontend/src/lib/evolution.js';

// Synthétique : 10 000 € début juillet, +5 000 € versés en août, 16 000 € fin octobre.
const points = [
  { date: '2026-04-01', total: 9000, deposits: null },
  { date: '2026-07-01', total: 10000, deposits: 10000 },
  { date: '2026-08-15', total: 15200, deposits: 15000 },
  { date: '2026-10-24', total: 16000, deposits: 15000 },
];

describe('évolution du patrimoine', () => {
  it('sépare les versements de l’effet du marché', () => {
    const e = evolution(points, '3m');
    expect(e.from).toBe('2026-08-15'); // 24/07 → première capture après
    expect(e.change).toBe(800);
    expect(e.deposits).toBe(0);
    expect(e.market).toBe(800);
  });

  it('sur toute la période : versements connus à partir de juillet seulement', () => {
    const e = evolution(points, 'all');
    expect(e.change).toBe(7000);
    expect(e.depositsFrom).toBe('2026-07-01');
    expect(e.deposits).toBe(5000);
    expect(e.market).toBe(1000); // (16 000 − 10 000) − 5 000
    // Dietz simple : 1 000 / (10 000 + 5 000 / 2) = 8 %
    expect(e.marketPct).toBeCloseTo(0.08, 6);
  });

  it('sans versements connus : variation seule', () => {
    const e = evolution(points.map((p) => ({ ...p, deposits: null })), 'all');
    expect(e.change).toBe(7000);
    expect(e.deposits).toBeNull();
    expect(e.market).toBeNull();
    expect(e.hasDeposits).toBe(false);
  });

  it('moins de deux captures sur la période : null', () => {
    expect(evolution([points[3]], 'all')).toBeNull();
    expect(evolution([], '1y')).toBeNull();
    expect(evolution([{ date: '2026-10-23', total: 0 }, { date: '2026-10-24', total: null }], 'all')).toBeNull();
  });
});
