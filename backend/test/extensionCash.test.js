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
    const { payload } = capture();
    expect(payload.cash_eur).toBe(605.89);
    expect(payload.total_value_eur).toBe(1605.89);
  });

  it('reconnaît le reliquat de change au lieu de le prendre pour une erreur', () => {
    // Notre somme indépendante ne PEUT pas inclure les 115 $ : cette réponse ne
    // porte aucun taux de change. Le contrôle affiche donc bien un reliquat…
    const { diagnostics } = capture();
    expect(diagnostics.computedTotal).toBe(1500); // 1000 de titres + 500 € lus
    expect(diagnostics.totalGap).toBe(105.89);
    // …mais il tient dans les 115 $ non convertis : ce n'est pas un défaut de
    // lecture. L'annoncer comme tel enverrait chercher un bug inexistant.
    expect(diagnostics.gapExplique).toBe(true);
  });

  it('ne laisse pas un solde en devise couvrir une vraie erreur de lecture', () => {
    // Le plafond reste une borne : 115 $ n'excusent pas 4 000 € manquants.
    const titreMalLu = structuredClone(update);
    titreMalLu.totalPortfolio.value.find((f) => f.name === 'reportNetliq').value = 5605.89;
    const { diagnostics } = buildPayload({
      update: titreMalLu, products: infos, transactions: null, captureId: 'c3', capturedAt: '2026-07-28T08:00:00Z',
    });
    expect(diagnostics.totalGap).toBe(4105.89);
    expect(diagnostics.gapExplique).toBe(false);
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

  it('nomme une position détenue dont la valeur n’a pas pu être lue', () => {
    // Le point aveugle : les trois autres contrôles exigent une valeur pour se
    // déclencher. Une position sans valeur comptait donc 0 € dans notre somme
    // et creusait l'écart sans que rien ne la désigne.
    const { diagnostics } = buildPayload({
      update: majUpdate([
        ligne({ id: '111', positionType: 'PRODUCT', size: 2, price: 500, value: 1000 }),
        ligne({ id: '222', positionType: 'PRODUCT', size: 100, price: 33 }), // pas de `value`
      ]),
      products: infosEur, transactions: null, captureId: 'c6', capturedAt: '2026-07-30T15:41:00Z',
    });
    expect(diagnostics.valued).toBe(1);
    expect(diagnostics.held).toBe(2);
    expect(diagnostics.suspects.some((s) => s.includes('Worldline') && s.includes('aucune valeur'))).toBe(true);
  });

  it('aucune piste quand tout est cohérent — pas de faux soupçons', () => {
    const { diagnostics } = capture();
    expect(diagnostics.suspects).toEqual([]);
  });
});

/**
 * Détail par devise : l'invariance qui remplace une somme.
 *
 * Rejoué sur les chiffres RÉELS de la capture du 03/08/2026, où 467,59 € de
 * titres restaient introuvables une fois le fonds de trésorerie déduit.
 */
describe('détail par devise', () => {
  const maj = (lignes, totaux) => ({
    portfolio: { value: lignes },
    totalPortfolio: { value: Object.entries(totaux).map(([name, value]) => ({ name, value })) },
  });
  const usd = (n, cours, valeur) => ligne({ id: String(300 + n), positionType: 'PRODUCT', size: 1, price: cours, value: valeur });
  const infosUsd = [{ data: Object.fromEntries([0, 1, 2, 3].map((n) => [
    String(300 + n), { isin: `US000000000${n}`, name: `Titre US ${n}`, productType: 'STOCK', currency: 'USD' },
  ])) }];
  const build = (lignes, totaux) => buildPayload({
    update: maj(lignes, totaux), products: infosUsd, transactions: null,
    captureId: 'k', capturedAt: '2026-08-03T09:04:41Z',
  });

  it('mesure un taux par devise, et le dit', () => {
    const { diagnostics } = build([
      usd(0, 1150, 1000), usd(1, 2300, 2000), usd(2, 1150, 1000),
      ligne({ id: 'EUR', positionType: 'CASH', value: 500 }),
    ], { reportPortfValue: 4000, reportCashBal: 500, reportNetliq: 4500 });
    const d = diagnostics.parDevise.find((x) => x.devise === 'USD');
    expect(d.lignes).toBe(3);
    expect(d.taux).toBeCloseTo(1000 / 1150, 6);
    expect(d.dispersion).toBeLessThan(1e-9); // les trois lignes s'accordent
    expect(d.controlee).toBe(true);
    expect(d.ecarts).toEqual([]);
  });

  it('NOMME la ligne convertie à un autre taux que ses voisines', () => {
    // Ce qu'une somme ne pouvait pas faire : trois lignes au même taux, une
    // quatrième 100 € trop basse. Le total était faux de 100 € — mais c'est la
    // LIGNE qu'il faut désigner, pas le total.
    const { diagnostics } = build([
      usd(0, 1150, 1000), usd(1, 1150, 1000), usd(2, 1150, 1000), usd(3, 1150, 900),
      ligne({ id: 'EUR', positionType: 'CASH', value: 500 }),
    ], { reportPortfValue: 4000, reportCashBal: 500, reportNetliq: 4500 });
    const d = diagnostics.parDevise.find((x) => x.devise === 'USD');
    expect(d.ecarts).toHaveLength(1);
    expect(d.ecarts[0]).toMatchObject({ nom: 'Titre US 3', valeur: 900, attendu: 1000, ecart: -100 });
    expect(diagnostics.suspects.some((s) => s.includes('Titre US 3') && s.includes('-100'))).toBe(true);
  });

  it('la médiane ne se laisse pas déplacer par l’aberrante qu’elle cherche', () => {
    // Avec une moyenne, la ligne fautive tirerait la référence vers elle et se
    // blanchirait à moitié — deux lignes seraient alors accusées au lieu d'une.
    const { diagnostics } = build([
      usd(0, 1000, 1000), usd(1, 1000, 1000), usd(2, 1000, 1000), usd(3, 1000, 5000),
      ligne({ id: 'EUR', positionType: 'CASH', value: 0 }),
    ], { reportPortfValue: 8000, reportCashBal: 0, reportNetliq: 8000 });
    const d = diagnostics.parDevise.find((x) => x.devise === 'USD');
    expect(d.taux).toBe(1);
    expect(d.ecarts).toHaveLength(1);
    expect(d.ecarts[0].nom).toBe('Titre US 3');
  });

  it('déclare une devise NON CONTRÔLÉE plutôt que saine sous trois lignes', () => {
    // Sur deux lignes, la médiane n'arbitre rien : chacune peut être la fautive.
    const { diagnostics } = build([
      usd(0, 1150, 1000), usd(1, 1150, 900),
      ligne({ id: 'EUR', positionType: 'CASH', value: 0 }),
    ], { reportPortfValue: 1900, reportCashBal: 0, reportNetliq: 1900 });
    const d = diagnostics.parDevise.find((x) => x.devise === 'USD');
    expect(d.controlee).toBe(false);
  });

  it('chiffre les titres que DEGIRO compte et que nous ne trouvons pas', () => {
    // Les chiffres réels du 03/08/2026. Le fonds (2 410,80 €) est déjà déduit :
    // ce qui reste ne lui est plus imputable, et c'était le chaînon manquant.
    const { diagnostics } = buildPayload({
      update: maj([
        ligne({ id: '300', positionType: 'PRODUCT', size: 1, price: 58895.47, value: 51003.48 }),
        ligne({ id: 'EUR', positionType: 'CASH', value: 9995.51 }),
      ], {
        reportPortfValue: 79993.367207,
        reportCashBal: 7584.707023,
        reportNetliq: 87578.07423,
      }),
      products: infosUsd, transactions: null, captureId: 'reel', capturedAt: '2026-08-03T09:04:41Z',
    });
    expect(diagnostics.fondsTresorerie).toBe(2410.8);
    // DEGIRO : 79 993,37 − 2 410,80 = 77 582,57 € de titres.
    expect(diagnostics.titresDegiro).toBe(77582.57);
    // Nous n'en trouvons que 51 003,48 sur cette ligne unique de test.
    expect(diagnostics.titresManquants).toBe(round2(77582.57 - 51003.48));
  });
});

const round2 = (n) => Math.round(n * 100) / 100;
