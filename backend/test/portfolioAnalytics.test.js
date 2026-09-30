import { describe, it, expect } from 'vitest';
import {
  analyzePortfolio, enrichLines, breakdown, diversification, crossTab, attentionPoints, linesToCsv,
  typeOf, FUNDS, UNCLASSIFIED, CASH,
} from '../../frontend/src/lib/portfolioAnalytics.js';
import {
  normalizeSector, normalizeCountry, regionOf, currencyOfCountry, isFund, ETF_CASH,
} from '../../frontend/src/lib/taxonomy.js';

// Données synthétiques : le dépôt est public, aucune position réelle ici.
const pf = {
  snapshot: { snapshot_date: '2026-09-29', total_value_eur: 12100, cash_eur: 2000 },
  positions: [
    { isin: 'US0000000001', name: 'Alpha Tech', currency: 'USD', sector: 'Technologie', country: 'États-Unis', asset_class: 'Action', qty: 10, value_eur: 4000, pl_eur: 2500, pl_day_eur: 40 },
    { isin: 'FR0000000002', name: 'Beta Banque', currency: 'EUR', sector: 'Finance', country: 'France', product_type: 'STOCK', qty: 50, value_eur: 1000, pl_eur: -600, pl_day_eur: -10 },
    { isin: 'IE0000000003', name: 'ISHARES CORE MSCI WORLD', currency: 'EUR', country: 'Irlande', asset_class: 'ETF', qty: 20, value_eur: 5000, pl_eur: 500, pl_day_eur: 25 },
    { isin: 'DE0000000004', name: 'Gamma Industrie', currency: 'EUR', sector: 'Industrials', country: 'Germany', qty: 1, value_eur: 60, pl_eur: null, pl_day_eur: null },
    { isin: 'NL0000000005', name: 'Soldée', currency: 'EUR', qty: 0, value_eur: 0 },
  ],
};

// Composition d'ETF telle que /api/lookthrough la renvoie : l'ETF (5 000 €) est
// éclaté ; Alpha Tech est détenu en direct ET via l'ETF.
const lookthrough = {
  coveredCount: 1,
  total: 10060,
  overlaps: [{ isin: 'US0000000001', name: 'Alpha Tech' }],
  trueHoldings: [
    { isin: 'US0000000001', name: 'Alpha Tech', direct: 4000, viaEtf: 500, sector: 'Information Technology', country: 'United States' },
    { isin: 'JP0000000006', name: 'Nippon Co', direct: 0, viaEtf: 1500, sector: 'Industrials', country: 'Japan' },
    { isin: 'GB0000000007', name: 'Brit Plc', direct: 0, viaEtf: 2500, sector: 'Consumer Staples', country: 'United Kingdom' },
    { isin: 'FR0000000002', name: 'Beta Banque', direct: 1000, viaEtf: 0, sector: 'Finance', country: 'France' },
    { isin: 'DE0000000004', name: 'Gamma Industrie', direct: 60, viaEtf: 0, sector: 'Industrials', country: 'Germany' },
    { isin: null, name: 'ISHARES CORE MSCI WORLD · reste', direct: 0, viaEtf: 500, sector: null, country: null },
  ],
};

describe('taxonomie', () => {
  it('normalise les secteurs GICS anglais et les libellés français sur un seul libellé', () => {
    expect(normalizeSector('Information Technology')).toBe('Technologie');
    expect(normalizeSector('Technologie')).toBe('Technologie');
    expect(normalizeSector("Technologie de l'information")).toBe('Technologie');
    expect(normalizeSector('Consumer Discretionary')).toBe('Consommation cyclique');
    expect(normalizeSector('Health Care')).toBe('Santé');
    expect(normalizeSector('Cash and/or Derivatives')).toBe(ETF_CASH);
    expect(normalizeSector('')).toBeNull();
    // Inconnu : gardé tel quel plutôt qu'inventé.
    expect(normalizeSector('Aéronautique')).toBe('Aéronautique');
  });

  it('normalise les pays et en déduit région et devise économique', () => {
    expect(normalizeCountry('United States')).toBe('États-Unis');
    expect(normalizeCountry('etats-unis')).toBe('États-Unis');
    expect(regionOf('Japan')).toBe('Asie-Pacifique développée');
    expect(regionOf('Taïwan')).toBe('Émergents');
    expect(regionOf('Royaume-Uni')).toBe('Europe');
    expect(currencyOfCountry('Allemagne')).toBe('EUR');
    expect(currencyOfCountry('United Kingdom')).toBe('GBP');
    expect(currencyOfCountry(null)).toBeNull();
  });

  it('reconnaît un fonds sans prendre NETFLIX pour un ETF', () => {
    expect(isFund({ name: 'NETFLIX INC' })).toBe(false);
    expect(isFund({ name: 'AMUNDI MSCI WORLD' })).toBe(true);
    expect(isFund({ asset_class: 'Action', name: 'ISHARES SPECIAL' })).toBe(false);
  });

  it('type lisible, même depuis le type DEGIRO brut', () => {
    expect(typeOf({ product_type: 'STOCK' })).toBe('Action');
    expect(typeOf({ name: 'XTRACKERS AI' })).toBe('ETF');
    expect(typeOf({ name: 'Inconnue SA' })).toBe('Non typé');
  });
});

describe('analyse du portefeuille', () => {
  const a = analyzePortfolio(pf);

  it('écarte les positions soldées et pèse sur les titres', () => {
    expect(a.lines).toHaveLength(4);
    expect(a.invested).toBe(10060);
    expect(a.lines.find((l) => l.isin === 'US0000000001').w).toBeCloseTo(4000 / 10060, 6);
  });

  it('plus-value : somme, % du coût, et part couverte — sans inventer la ligne inconnue', () => {
    expect(a.pl.total).toBe(2400);
    // Coût des lignes renseignées : (4000-2500) + (1000+600) + (5000-500) = 7600.
    expect(a.pl.pct).toBeCloseTo(2400 / 7600, 6);
    expect(a.pl.coverage).toBeCloseTo(10000 / 10060, 6);
    expect(a.lines.find((l) => l.isin === 'DE0000000004').plPct).toBeNull();
  });

  it('coût moyen par titre en euros, et réalisé des ventes partielles à part', () => {
    const b = analyzePortfolio({ snapshot: {}, positions: [
      { isin: 'X1', name: 'Partielle', qty: 10, value_eur: 600, pl_eur: 500, pl_realized_eur: 3600 },
      { isin: 'X2', name: 'Entière', qty: 4, value_eur: 400, pl_eur: -100 },
    ] });
    expect(b.lines.find((l) => l.isin === 'X1').avgCost).toBe(10);
    expect(b.lines.find((l) => l.isin === 'X2').avgCost).toBe(125);
    expect(b.realized).toEqual({ total: 3600, count: 1 });
    // Le % latent porte sur le coût des titres détenus, pas sur le flux net.
    expect(b.lines.find((l) => l.isin === 'X1').plPct).toBe(5);
    expect(a.realized).toBeNull();
  });

  it('variation du jour en % de la valeur de la veille', () => {
    expect(a.day.total).toBe(55);
    expect(a.day.pct).toBeCloseTo(55 / (10000 - 55), 6);
  });

  it('allocation du patrimoine, liquidités comprises, qui somme à 100 %', () => {
    expect(a.allocation.find((x) => x.key === CASH).value).toBe(2000);
    expect(a.allocation.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1, 9);
    expect(a.cashShare).toBeCloseTo(2000 / 12060, 6);
  });

  it('concentration : top 5, nombre effectif de lignes', () => {
    const c = a.concentration;
    expect(c.n).toBe(4);
    expect(c.top1).toBeCloseTo(5000 / 10060, 6);
    const hhi = [5000, 4000, 1000, 60].reduce((s, v) => s + (v / 10060) ** 2, 0);
    expect(c.effective).toBeCloseTo(1 / hhi, 6);
    expect(c.effective).toBeLessThan(4);
  });

  it('gagnants et perdants triés par montant', () => {
    expect(a.gainers.map((l) => l.isin)).toEqual(['US0000000001', 'IE0000000003']);
    expect(a.losers.map((l) => l.isin)).toEqual(['FR0000000002']);
  });

  it('portefeuille importé par CSV : pas de plus-value affichée comme zéro', () => {
    const csv = analyzePortfolio({ snapshot: {}, positions: pf.positions.map(({ pl_eur: _p, pl_day_eur: _d, ...r }) => r) });
    expect(csv.pl).toBeNull();
    expect(csv.day).toBeNull();
  });

  it('portefeuille vide : aucune division par zéro', () => {
    const vide = analyzePortfolio({ snapshot: {}, positions: [] });
    expect(vide.invested).toBe(0);
    expect(vide.concentration.effective).toBe(0);
    expect(attentionPoints(vide)).toEqual([]);
  });
});

describe('répartitions', () => {
  const lines = enrichLines(pf.positions);

  it('vue directe : l’ETF non éclaté reste à part, jamais compté en Irlande', () => {
    const pays = breakdown(lines, 'country');
    expect(pays.find((b) => b.key === FUNDS).value).toBe(5000);
    expect(pays.find((b) => b.key === 'Irlande')).toBeUndefined();
    // Secteur anglais d'une référence ISIN normalisé comme les autres.
    expect(breakdown(lines, 'sector').find((b) => b.key === 'Industrie').value).toBe(60);
  });

  it('vue éclatée : l’ETF est remplacé par ses constituants, total conservé', () => {
    const secteurs = breakdown(lines, 'sector', lookthrough);
    expect(secteurs.reduce((s, b) => s + b.value, 0)).toBeCloseTo(10060, 6);
    expect(secteurs.find((b) => b.key === FUNDS)).toBeUndefined();
    // Technologie = Alpha Tech en direct (4 000) + via ETF (500), une seule entrée.
    const tech = secteurs.find((b) => b.key === 'Technologie');
    expect(tech.value).toBe(4500);
    expect(tech.items).toEqual([{ name: 'Alpha Tech', isin: 'US0000000001', value: 4500, direct: 4000, viaEtf: 500 }]);
    // Le reste non détaillé de l'ETF n'est pas inventé.
    expect(secteurs.find((b) => b.key === UNCLASSIFIED).value).toBe(500);
  });

  it('devise économique éclatée : la poche britannique de l’ETF compte en livres', () => {
    const dev = breakdown(lines, 'currency', lookthrough);
    expect(dev.find((b) => b.key === 'GBP').value).toBe(2500);
    expect(dev.find((b) => b.key === 'USD').value).toBe(4500);
    // La devise de cotation, elle, ne s'éclate pas.
    expect(breakdown(lines, 'quote', lookthrough).find((b) => b.key === 'EUR').value).toBe(6060);
  });

  it('diversification calculée sur la seule part classée', () => {
    const d = diversification(breakdown(lines, 'sector'));
    // Classés : Technologie 4 000, Finance 1 000, Industrie 60 — l'ETF à part.
    expect(d.count).toBe(3);
    expect(d.coverage).toBeCloseTo(5060 / 10060, 6);
    expect(d.top.key).toBe('Technologie');
    expect(diversification([])).toMatchObject({ effective: 0, count: 0 });
  });

  it('tableau croisé secteur × région : les cellules somment à 100 %', () => {
    const t = crossTab(lines, lookthrough);
    let sum = 0;
    for (const r of t.rows) for (const c of t.cols) sum += t.cell(r, c);
    expect(sum).toBeCloseTo(1, 9);
    expect(t.cell('Technologie', 'Amérique du Nord')).toBeCloseTo(4500 / 10060, 6);
    expect(t.cell('Industrie', 'Asie-Pacifique développée')).toBeCloseTo(1500 / 10060, 6);
  });
});

describe('points d’attention', () => {
  const a = analyzePortfolio(pf);
  const points = attentionPoints(a, { lookthrough, sectors: breakdown(a.lines, 'sector', lookthrough) });
  const byId = Object.fromEntries(points.map((p) => [p.id, p]));

  it('signale les lignes lourdes, avec leur coût en cas de baisse', () => {
    expect(byId.big.isins).toEqual(['IE0000000003', 'US0000000001']);
    expect(byId.big.detail).toMatch(/1\s800\s€/);
  });

  it('signale les pertes profondes et les lignes qui ont doublé', () => {
    expect(byId.loss.isins).toEqual(['FR0000000002']);
    expect(byId.doubled.isins).toEqual(['US0000000001']);
  });

  it('signale la surexposition direct + ETF', () => {
    expect(byId.overlap.isins).toEqual(['US0000000001']);
  });

  it('aucun point sur la plus-value manquante quand elle est connue', () => {
    expect(byId.nopl).toBeUndefined();
  });
});

describe('export CSV', () => {
  it('séparateur « ; », décimales à virgule, champs protégés', () => {
    const lines = enrichLines([{ isin: 'X', name: 'A; "B"', qty: 1.5, value_eur: 10.25, currency: 'EUR' }]);
    const [head, row] = linesToCsv(lines).split('\r\n');
    expect(head.split(';')[0]).toBe('Titre');
    expect(row.startsWith('"A; ""B"""')).toBe(true);
    expect(row).toContain(';1,5;');
    expect(row).toContain(';10,25;');
  });
});
