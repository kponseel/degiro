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

  it('convertit un solde en devise au taux de ses propres titres, sans le perdre', () => {
    // Ne sommer que l'euro laissait les 115 $ de côté. Ils sont convertis au
    // taux que DEGIRO applique à la ligne en dollars (1 000 / 1 200).
    const { payload, diagnostics } = capture();
    expect(payload.cash_eur).toBe(round2(500 + 115 * (1000 / 1200)));
    expect(diagnostics.devisesConverties).toEqual([{ currency: 'USD', value: 115, eur: 95.83 }]);
    // Le total reste celui de DEGIRO : c'est lui que l'utilisateur compare.
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

  it('lit les liquidités sur ses lignes même sans total DEGIRO', () => {
    const sansTotal = { portfolio: update.portfolio };
    const { payload } = buildPayload({
      update: sansTotal, products: infos, transactions: null, captureId: 'c2', capturedAt: '2026-07-28T08:00:00Z',
    });
    expect(payload.cash_eur).toBe(595.83);
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

/**
 * La capture réelle du 29/09/2026, reconstituée avec des lignes synthétiques
 * mais les mêmes totaux : 10 lignes en euros exactes au centime, 10 lignes en
 * dollars toutes au même taux, et un total DEGIRO plus haut de 91,99 €.
 *
 * Deux défauts se cachaient derrière ce seul chiffre : un « ✗ » alarmant alors
 * qu'aucune ligne n'était mal lue, et des liquidités gonflées de 91,99 € parce
 * qu'elles étaient DÉDUITES du total (total − titres) au lieu d'être lues.
 */
describe('écart de change entre les lignes et le total DEGIRO', () => {
  const eur = (n, v) => ligne({ id: String(500 + n), positionType: 'PRODUCT', size: 1, price: v, value: v });
  const usd = (n, local) => ligne({ id: String(600 + n), positionType: 'PRODUCT', size: 1, price: local, value: round2(local * 0.8794) });
  const infosMixtes = [{ data: Object.fromEntries([
    ...[...Array(10).keys()].map((n) => [String(500 + n), { isin: `FR000000000${n}`, name: `Titre FR ${n}`, productType: 'STOCK', currency: 'EUR' }]),
    ...[...Array(10).keys()].map((n) => [String(600 + n), { isin: `US000000001${n}`, name: `Titre US ${n}`, productType: 'STOCK', currency: 'USD' }]),
  ]) }];
  // 10 × 2 530,30 € = 25 303,00 € ; 10 × 3 905,84 $ au taux 0,8794.
  const lignes = [
    ...[...Array(10).keys()].map((n) => eur(n, 2530.3)),
    ...[...Array(10).keys()].map((n) => usd(n, 3905.84)),
    ligne({ id: 'EUR', positionType: 'CASH', value: 3902.74 }),
    ligne({ id: 'FLATEX_EUR', positionType: 'CASH', value: 26266.84 }),
  ];
  const titres = round2(10 * 2530.3 + 10 * round2(3905.84 * 0.8794));
  const totaux = (ecart) => ({
    portfolio: { value: lignes },
    totalPortfolio: { value: [
      { name: 'reportPortfValue', value: titres + 3902.74 + ecart },
      { name: 'reportCashBal', value: 26266.84 },
      { name: 'reportNetliq', value: titres + 3902.74 + 26266.84 + ecart + 0.004152 },
    ] },
  });
  const build = (ecart) => buildPayload({ update: totaux(ecart), products: infosMixtes, captureId: 'fx', capturedAt: '2026-09-29T09:00:00Z' });

  it('liquidités = celles de l’écran DEGIRO, pas le total moins nos titres', () => {
    const { payload } = build(91.99);
    expect(payload.cash_eur).toBe(30169.58);
  });

  it('total arrondi au centime', () => {
    const { payload } = build(91.99);
    expect(payload.total_value_eur).toBe(round2(titres + 30169.58 + 91.99));
  });

  it('reconnaît l’écart de change, chiffré, au lieu d’un ✗', () => {
    const { diagnostics } = build(91.99);
    expect(diagnostics.totalGap).toBe(91.99);
    expect(diagnostics.ecartChange.devises).toEqual(['USD']);
    expect(diagnostics.ecartChange.tauxLignes).toBeCloseTo(0.8794, 5);
    expect(diagnostics.ecartChange.tauxTotal).toBeGreaterThan(0.8794);
    expect(diagnostics.ecartChange.part).toBeCloseTo(91.99 / (10 * round2(3905.84 * 0.8794)), 4);
  });

  it('ne l’invoque pas pour un écart trop grand pour être du change', () => {
    // 5 000 € sur 34 000 € de titres en dollars : ce n'est plus un taux, c'est un titre qui manque.
    expect(build(5000).diagnostics.ecartChange).toBeNull();
  });

  it('ne l’invoque pas quand une ligne est nommée comme suspecte', () => {
    const faussee = totaux(91.99);
    faussee.portfolio.value = structuredClone(lignes);
    // Une ligne en dollars convertie à un autre taux que ses voisines.
    faussee.portfolio.value[10].value.find((f) => f.name === 'value').value -= 50;
    const { diagnostics } = buildPayload({ update: faussee, products: infosMixtes, captureId: 'fx2', capturedAt: '2026-09-29T09:00:00Z' });
    expect(diagnostics.suspects.length).toBeGreaterThan(0);
    expect(diagnostics.ecartChange).toBeNull();
  });

  it('ne l’invoque jamais pour un portefeuille tout en euros', () => {
    const toutEuro = {
      portfolio: { value: [...lignes.slice(0, 10), ...lignes.slice(20)] },
      totalPortfolio: { value: [
        { name: 'reportPortfValue', value: 25303 + 3902.74 + 91.99 },
        { name: 'reportCashBal', value: 26266.84 },
        { name: 'reportNetliq', value: 25303 + 30169.58 + 91.99 },
      ] },
    };
    const { diagnostics } = buildPayload({ update: toutEuro, products: infosMixtes, captureId: 'fx3', capturedAt: '2026-09-29T09:00:00Z' });
    expect(diagnostics.totalGap).toBe(91.99);
    expect(diagnostics.ecartChange).toBeNull();
  });

  it('nomme une position soldée que DEGIRO valorise encore', () => {
    const avecSoldee = totaux(91.99);
    avecSoldee.portfolio.value = [...lignes, ligne({ id: '700', positionType: 'PRODUCT', size: 0, price: 124, value: 91.99 })];
    const infos2 = structuredClone(infosMixtes);
    infos2[0].data['700'] = { isin: 'US69608A1088', name: 'Titre vendu', productType: 'STOCK', currency: 'USD' };
    const { diagnostics } = buildPayload({ update: avecSoldee, products: infos2, captureId: 'fx4', capturedAt: '2026-09-29T09:00:00Z' });
    expect(diagnostics.suspects.some((s) => /Titre vendu : soldée mais valorisée 91.99/.test(s))).toBe(true);
    expect(diagnostics.ecartChange).toBeNull();
  });
});

const round2 = (n) => Math.round(n * 100) / 100;
