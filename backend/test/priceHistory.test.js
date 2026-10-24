import { describe, it, expect } from 'vitest';
import {
  toEur, monthsBefore, windowStats, historyStats, fxCurrencyOf, indexHistory,
} from '../../frontend/src/lib/priceHistory.js';

// Synthétique : une action américaine passée de 100 $ à 30 $ sur un an.
const days = (from, n) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});

describe('historique — conversion en euros au taux du jour', () => {
  const fx = { USD: [['2026-01-02', 1.25], ['2026-06-01', 1.0]] };

  it('applique le dernier taux connu à chaque date', () => {
    const { points, unit } = toEur([['2026-01-05', 125], ['2026-06-03', 125]], 'USD', fx);
    expect(unit).toBe('EUR');
    expect(points).toEqual([['2026-01-05', 100], ['2026-06-03', 125]]);
  });

  it('avant le premier taux : le premier taux ; pence → livres', () => {
    expect(toEur([['2025-12-01', 125]], 'USD', fx).points[0][1]).toBe(100);
    expect(fxCurrencyOf('GBX')).toEqual({ code: 'GBP', divisor: 100 });
    expect(toEur([['2026-01-05', 500]], 'GBX', { GBP: [['2026-01-01', 0.5]] }).points[0][1]).toBe(10);
  });

  it('sans taux : reste dans la devise d’origine, jamais de conversion inventée', () => {
    const r = toEur([['2026-01-05', 125]], 'JPY', fx);
    expect(r.unit).toBe('JPY');
    expect(r.points[0][1]).toBe(125);
  });

  it('euros : inchangés', () => {
    expect(toEur([['2026-01-05', 42]], 'EUR', {})).toEqual({ points: [['2026-01-05', 42]], unit: 'EUR' });
  });
});

describe('historique — fenêtres', () => {
  it('recul en mois, fin de mois bornée', () => {
    expect(monthsBefore('2026-10-24', 3)).toBe('2026-07-24');
    expect(monthsBefore('2026-05-31', 3)).toBe('2026-02-28');
    expect(monthsBefore('2026-01-15', 12)).toBe('2025-01-15');
  });

  it('plus haut, plus bas, moyenne sur la fenêtre', () => {
    const s = windowStats([['2026-01-01', 10], ['2026-02-01', 30], ['2026-03-01', 20]], '2026-01-15');
    expect(s).toMatchObject({ high: 30, highDate: '2026-02-01', low: 20, lowDate: '2026-03-01', avg: 25, n: 2 });
    expect(windowStats([['2026-01-01', 10]], '2026-06-01')).toBeNull();
  });
});

describe('historique — repères d’une ligne en forte baisse', () => {
  // 365 jours, de 100 € à 30 € en ligne droite (cotée en euros pour la lisibilité).
  const d = days('2025-10-25', 365);
  const daily = d.map((day, i) => [day, 100 - (70 * i) / 364]);
  const weekly = [['2021-11-01', 150], ['2023-06-05', 180], ['2025-09-01', 110]];
  // 10 titres à 30 € = 300 € ; coût 800 € → PRU 80 €, latent −500 €.
  const position = { qty: 10, value_eur: 300, pl_eur: -500 };
  const h = historyStats({ currency: 'EUR', daily, weekly }, {}, position);

  it('cours actuel = dernier point relevé', () => {
    expect(h.now).toBe(30);
    expect(h.unit).toBe('EUR');
    expect(h.converted).toBe(false);
  });

  it('chaque repère dit la hausse nécessaire pour y revenir', () => {
    expect(h.windows.m12.high).toBeCloseTo(100, 6);
    expect(h.windows.m12.toHigh).toBeCloseTo(100 / 30 - 1, 6); // +233 %
    expect(h.windows.m12.fromHigh).toBeCloseTo(-0.7, 6); // −70 % depuis le plus haut
    expect(h.windows.m3.high).toBeLessThan(h.windows.m6.high);
    expect(h.windows.m6.avg).toBeGreaterThan(h.windows.m3.avg);
    expect(h.windows.m3.toAvg).toBeGreaterThan(0);
  });

  it('5 ans : l’hebdomadaire ancien complète le quotidien', () => {
    expect(h.windows.y5.high).toBe(180);
    expect(h.windows.y5.highDate).toBe('2023-06-05');
    expect(h.long[0]).toEqual(['2021-11-01', 150]);
  });

  it('PRU : niveau, hausse nécessaire, dernier passage au-dessus', () => {
    expect(h.pru.level).toBe(80);
    expect(h.pru.toLevel).toBeCloseTo(80 / 30 - 1, 6);
    // La droite passe sous 80 € vers le jour 104 : dernier jour ≥ 80 €.
    const last = daily.filter(([, v]) => v >= 80).pop()[0];
    expect(h.pru.lastAbove).toBe(last);
  });

  it('PRU jamais atteint sur la période', () => {
    const r = historyStats({ currency: 'EUR', daily, weekly: [] }, {}, { qty: 1, value_eur: 30, pl_eur: -170 });
    expect(r.pru.level).toBe(200);
    expect(r.pru.lastAbove).toBeNull();
  });

  it('sans historique : null ; index par ISIN', () => {
    expect(historyStats(null, {}, position)).toBeNull();
    expect(historyStats({ currency: 'EUR', daily: [], weekly: [] }, {}, position)).toBeNull();
    expect(indexHistory({ series: [{ isin: 'FR0000000001' }] }).get('FR0000000001')).toEqual({ isin: 'FR0000000001' });
  });

  it('ligne en dollars sans taux : repères en dollars, pas de PRU en euros', () => {
    const r = historyStats({ currency: 'USD', daily, weekly: [] }, {}, position);
    expect(r.unit).toBe('USD');
    expect(r.pru).toBeNull();
    expect(r.now).toBeCloseTo(30, 6); // dernier cours, pas la valeur en euros
  });
});
