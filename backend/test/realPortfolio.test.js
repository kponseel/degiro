import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv, detectKind, mapPortfolio, extractCashEur } from '../src/services/csvParser.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// Vrais exports DEGIRO (montants modifiés) — anglais et français.
describe.each([
  ['portfolio-real.csv', 'anglais (Symbol/ISIN, Amount, Local value)'],
  ['portfolio-real-fr.csv', 'français (Ticker/ISIN, Quantité, Devise)'],
])('vrai Portfolio DEGIRO — %s', (file) => {
  const { rows } = parseCsv(fixture(file));

  it('est détecté comme portefeuille', () => {
    expect(detectKind(rows)).toBe('portfolio');
  });

  it('extrait 27 positions valides (ligne cash exclue)', () => {
    const positions = mapPortfolio(rows);
    expect(positions).toHaveLength(27);
    expect(positions.every((p) => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(p.isin))).toBe(true);
  });

  it('lit correctement quantité, devise et valeur EUR', () => {
    const positions = mapPortfolio(rows);
    const alibaba = positions.find((p) => p.isin === 'US01609W1027');
    expect(alibaba.qty).toBe(46);
    expect(alibaba.price).toBe(116.56);
    expect(alibaba.currency).toBe('USD');
    expect(alibaba.value_eur).toBe(4698.51);

    const amundi = positions.find((p) => p.isin === 'LU1681038243');
    expect(amundi.currency).toBe('EUR');
    expect(amundi.value_eur).toBe(2633.85);

    // ISIN aux formats variés (chiffres + lettres)
    expect(positions.find((p) => p.isin === 'FR001400X2S4')).toBeTruthy(); // Atos
    expect(positions.find((p) => p.isin === 'IE00BGV5VN51')).toBeTruthy(); // Xtrackers AI
  });

  it('capture la ligne de liquidités', () => {
    expect(extractCashEur(rows)).toBe(6435.86);
  });

  it('la somme des positions est cohérente', () => {
    const positions = mapPortfolio(rows);
    const total = positions.reduce((s, p) => s + p.value_eur, 0);
    expect(total).toBeGreaterThan(80000);
    expect(total).toBeLessThan(100000);
  });
});
