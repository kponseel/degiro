import { describe, it, expect } from 'vitest';
import { diffSnapshots } from '../../frontend/src/lib/snapshotDiff.js';

// Synthétique : deux captures extension à 4 jours d'écart.
const previous = {
  snapshot: { snapshot_date: '2026-10-08', source: 'extension', total_value_eur: 10000, cash_eur: 1000 },
  positions: [
    { isin: 'FR0000000001', name: 'Alpha', qty: 10, value_eur: 1000 },  // 100 €/titre
    { isin: 'FR0000000002', name: 'Beta', qty: 20, value_eur: 2000 },   // 100 €/titre
    { isin: 'FR0000000003', name: 'Gamma', qty: 5, value_eur: 500 },    // vendue
    { isin: 'FR0000000004', name: 'Delta', qty: 50, value_eur: 5500 },
  ],
};
const latest = {
  snapshot: { snapshot_date: '2026-10-12', source: 'extension', total_value_eur: 10600, cash_eur: 900 },
  positions: [
    { isin: 'FR0000000001', name: 'Alpha', qty: 10, value_eur: 1200 },  // +20 % à quantité constante
    { isin: 'FR0000000002', name: 'Beta', qty: 30, value_eur: 2700 },   // renforcée, 90 €/titre
    { isin: 'FR0000000004', name: 'Delta', qty: 50, value_eur: 5500 },
    { isin: 'FR0000000005', name: 'Epsilon', qty: 3, value_eur: 300 },  // nouvelle
  ],
};

describe('depuis ta dernière capture', () => {
  const d = diffSnapshots(latest, previous);

  it('date, écart en jours, total et liquidités', () => {
    expect(d.since).toBe('2026-10-08');
    expect(d.days).toBe(4);
    expect(d.totalDelta).toBe(600);
    expect(d.totalPct).toBeCloseTo(0.06, 9);
    expect(d.cashDelta).toBe(-100);
  });

  it('effet marché à quantité constante, séparé des achats', () => {
    // Alpha : 10 × (120 − 100) = +200 ; Beta : 20 × (90 − 100) = −200 ; Delta : 0.
    expect(d.up).toEqual([{ isin: 'FR0000000001', name: 'Alpha', move: 200, pct: expect.closeTo(0.2, 9) }]);
    expect(d.down.map((m) => [m.isin, m.move])).toEqual([['FR0000000002', -200]]);
    expect(d.market).toBe(0);
  });

  it('tes décisions : lignes nouvelles, soldées, quantités modifiées', () => {
    expect(d.added.map((x) => x.isin)).toEqual(['FR0000000005']);
    expect(d.closed.map((x) => x.isin)).toEqual(['FR0000000003']);
    // +10 titres de Beta au cours du jour (90 €) : ≈ +900 €.
    expect(d.resized).toEqual([{ isin: 'FR0000000002', name: 'Beta', from: 20, to: 30, approx: 900 }]);
  });

  it('franchissements de seuil de poids', () => {
    // Delta : 5500/9000 = 61 % → 5500/9700 = 57 % : déjà au-dessus, rien ne change.
    // Beta : 22 % → 28 % : déjà au-dessus. Alpha : 11 % → 12 % : déjà au-dessus de 10 %.
    expect(d.crossings).toEqual([]);
    const lourde = diffSnapshots(
      { ...latest, positions: [{ isin: 'X', name: 'X', qty: 1, value_eur: 200 }, { isin: 'Y', name: 'Y', qty: 1, value_eur: 800 }] },
      { ...previous, positions: [{ isin: 'X', name: 'X', qty: 1, value_eur: 50 }, { isin: 'Y', name: 'Y', qty: 1, value_eur: 950 }] },
    );
    expect(lourde.crossings).toEqual([
      { isin: 'X', name: 'X', threshold: 0.1, up: true, weight: 0.2 },
      { isin: 'X', name: 'X', threshold: 0.15, up: true, weight: 0.2 },
    ]);
  });

  it('jamais entre deux sources différentes, ni sans capture précédente', () => {
    expect(diffSnapshots(latest, { ...previous, snapshot: { ...previous.snapshot, source: 'csv' } })).toBeNull();
    expect(diffSnapshots(latest, null)).toBeNull();
  });

  it('quantité ou valeur manquante : pas de mouvement inventé', () => {
    const r = diffSnapshots(
      { ...latest, positions: [{ isin: 'X', name: 'X', qty: null, value_eur: 100 }] },
      { ...previous, positions: [{ isin: 'X', name: 'X', qty: null, value_eur: 80 }] },
    );
    expect(r.up).toEqual([]);
    expect(r.market).toBeNull();
  });
});
