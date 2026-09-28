import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseNumberEu,
  sniffDelimiter,
  parseCsv,
  detectKind,
  mapPortfolio,
} from '../src/services/csvParser.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('parseNumberEu', () => {
  it('gère décimales à virgule et séparateurs de milliers', () => {
    expect(parseNumberEu('1.234,56')).toBe(1234.56);
    expect(parseNumberEu('12,50')).toBe(12.5);
    expect(parseNumberEu('-2,00')).toBe(-2);
    expect(parseNumberEu('9.500,00')).toBe(9500);
    expect(parseNumberEu('1234.56')).toBe(1234.56);
    expect(parseNumberEu('')).toBeNull();
    expect(parseNumberEu(null)).toBeNull();
  });
});

describe('sniffDelimiter', () => {
  it('détecte la virgule et le point-virgule', () => {
    expect(sniffDelimiter('a,b,c')).toBe(',');
    expect(sniffDelimiter('a;b;c')).toBe(';');
  });
});

describe('detectKind', () => {
  // Relevé et historique d'ordres restent reconnus : c'est ce qui permet d'expliquer leur refus.
  it('reconnaît les trois exports', () => {
    expect(detectKind(parseCsv(fixture('portfolio.csv')).rows)).toBe('portfolio');
    expect(detectKind(parseCsv(fixture('account.csv')).rows)).toBe('account');
    expect(detectKind(parseCsv(fixture('transactions.csv')).rows)).toBe('transactions');
  });
});

describe('mapPortfolio', () => {
  it('extrait les positions valides et ignore la ligne cash (sans ISIN)', () => {
    const rows = parseCsv(fixture('portfolio.csv')).rows;
    const positions = mapPortfolio(rows);
    expect(positions).toHaveLength(3);
    const nvda = positions.find((p) => p.isin === 'US67066G1040');
    expect(nvda.qty).toBe(10);
    expect(nvda.price).toBe(120.5);
    expect(nvda.value_eur).toBe(1050);
    expect(nvda.currency).toBe('USD');
  });
});
