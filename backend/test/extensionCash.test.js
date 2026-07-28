import { describe, it, expect } from 'vitest';
import { parsePortfolio, buildPayload } from '../../extension/src/degiro.js';

/** Ligne DEGIRO au format `{ value: [{ name, value }] }`. */
const ligne = (champs) => ({ value: Object.entries(champs).map(([name, value]) => ({ name, value })) });

const update = {
  portfolio: {
    value: [
      ligne({ id: '331868', positionType: 'PRODUCT', size: 10, price: 120, value: 1000, plBase: { EUR: -800 } }),
      ligne({ id: 'EUR', positionType: 'CASH', value: 500 }),
      // Solde en dollars : alimenté par les dividendes de titres américains.
      ligne({ id: 'FLATEX_USD', positionType: 'CASH', value: 115 }),
    ],
  },
  totalPortfolio: {
    value: [
      { name: 'reportPortfValue', value: 1000 },
      // DEGIRO convertit lui-même : 500 € + 115 $ ≈ 605,89 €.
      { name: 'reportCashBal', value: 605.89 },
      { name: 'reportNetliq', value: 1605.89 },
    ],
  },
};

const infos = [{ data: { 331868: { isin: 'US67066G1040', symbol: 'NVDA', name: 'NVIDIA', productType: 'STOCK', currency: 'USD' } } }];

const capture = () => buildPayload({
  update, products: infos, transactions: null, captureId: 'c1', capturedAt: '2026-07-28T08:00:00Z',
});

describe('liquidités en devises', () => {
  it('recense les soldes non convertibles au lieu de les perdre', () => {
    const { cashEur, cashOther } = parsePortfolio(update);
    expect(cashEur).toBe(500);
    expect(cashOther).toEqual([{ currency: 'USD', value: 115 }]);
  });

  it("s'appuie sur le solde total converti par DEGIRO, pas sur les seules lignes en euros", () => {
    // Le défaut : ne sommer que l'euro laissait 105,89 € de côté et faisait
    // apparaître un écart avec le total DEGIRO, sans dire d'où il venait.
    const { payload, diagnostics } = capture();
    expect(payload.cash_eur).toBe(605.89);
    expect(diagnostics.computedTotal).toBe(1605.89);
    expect(diagnostics.totalGap).toBe(0);
  });

  it('le diagnostic nomme les devises restées de côté', () => {
    const { diagnostics } = capture();
    expect(diagnostics.cashOther).toEqual([{ currency: 'USD', value: 115 }]);
  });

  it('retombe sur la somme des lignes en euros si DEGIRO ne donne pas de total', () => {
    const sansTotal = { portfolio: update.portfolio };
    const { payload } = buildPayload({
      update: sansTotal, products: infos, transactions: null, captureId: 'c2', capturedAt: '2026-07-28T08:00:00Z',
    });
    expect(payload.cash_eur).toBe(500);
  });

  it('un portefeuille sans liquidités ne déclare pas de cash', () => {
    const { payload } = buildPayload({
      update: { portfolio: { value: [update.portfolio.value[0]] } },
      products: infos,
      transactions: null,
      captureId: 'c3',
      capturedAt: '2026-07-28T08:00:00Z',
    });
    expect(payload.cash_eur).toBeUndefined();
  });
});
