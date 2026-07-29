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

describe('pistes nominatives pour un écart côté titres', () => {
  // Le 29/07/2026, un écart réel de 1 412,78 € restait un chiffre nu : rien ne
  // disait QUELLE ligne regarder. Le diagnostic doit nommer les suspects.
  const majUpdate = (lignes, portf = 3000) => ({
    portfolio: { value: lignes },
    totalPortfolio: {
      value: [
        { name: 'reportPortfValue', value: portf },
        { name: 'reportCashBal', value: 0 },
        { name: 'reportNetliq', value: portf },
      ],
    },
  });
  const infosEur = [{ data: {
    111: { isin: 'FR0000121014', symbol: 'MC', name: 'LVMH', productType: 'STOCK', currency: 'EUR' },
    222: { isin: 'FR00140182K6', symbol: 'WLN', name: 'Worldline', productType: 'STOCK', currency: 'EUR' },
  } }];

  it("nomme l'action en euros dont la valeur DEGIRO contredit cours × quantité", () => {
    const { diagnostics } = buildPayload({
      update: majUpdate([
        ligne({ id: '111', positionType: 'PRODUCT', size: 2, price: 500, value: 1000 }),
        // Worldline : 100 × 2,80 € devrait valoir 280 €, DEGIRO annonce 1 692 €.
        ligne({ id: '222', positionType: 'PRODUCT', size: 100, price: 2.8, value: 1692.78 }),
      ]),
      products: infosEur, transactions: null, captureId: 'c3', capturedAt: '2026-07-29T13:00:00Z',
    });
    expect(diagnostics.suspects).toHaveLength(1);
    expect(diagnostics.suspects[0]).toContain('Worldline');
    expect(diagnostics.suspects[0]).toContain('280');
  });

  it('nomme une valeur reçue dans une autre devise que l’euro', () => {
    const { diagnostics } = buildPayload({
      update: majUpdate([
        ligne({ id: '111', positionType: 'PRODUCT', size: 2, price: 500, value: { USD: 1140 } }),
      ]),
      products: infosEur, transactions: null, captureId: 'c4', capturedAt: '2026-07-29T13:00:00Z',
    });
    expect(diagnostics.suspects.some((s) => s.includes('USD'))).toBe(true);
  });

  it('nomme une ligne valorisée mais sans quantité, exclue de notre somme', () => {
    const { diagnostics } = buildPayload({
      update: majUpdate([
        ligne({ id: '222', positionType: 'PRODUCT', value: 1412.78 }),
      ]),
      products: infosEur, transactions: null, captureId: 'c5', capturedAt: '2026-07-29T13:00:00Z',
    });
    expect(diagnostics.suspects).toHaveLength(1);
    expect(diagnostics.suspects[0]).toContain('Worldline');
    expect(diagnostics.suspects[0]).toContain('sans quantité');
  });

  it('aucune piste quand tout est cohérent — pas de faux soupçons', () => {
    const { diagnostics } = capture();
    expect(diagnostics.suspects).toEqual([]);
  });
});
