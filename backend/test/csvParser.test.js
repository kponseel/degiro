import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseNumberEu,
  parseDateEu,
  sniffDelimiter,
  parseCsv,
  detectKind,
  mapPortfolio,
  mapAccount,
  mapTransactions,
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

describe('parseDateEu', () => {
  it('convertit JJ-MM-AAAA (+ heure) en datetime', () => {
    expect(parseDateEu('20-07-2026', '09:05')).toBe('2026-07-20 09:05:00');
    expect(parseDateEu('18-07-2026')).toBe('2026-07-18 00:00:00');
    expect(parseDateEu('pas une date')).toBeNull();
  });
});

describe('sniffDelimiter', () => {
  it('détecte la virgule et le point-virgule', () => {
    expect(sniffDelimiter('a,b,c')).toBe(',');
    expect(sniffDelimiter('a;b;c')).toBe(';');
  });
});

describe('detectKind', () => {
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

describe('mapAccount', () => {
  it('classe les mouvements par description', () => {
    const rows = parseCsv(fixture('account.csv')).rows;
    const txs = mapAccount(rows);
    expect(txs).toHaveLength(4);
    const byType = Object.fromEntries(txs.map((t) => [t.type, t]));
    expect(byType.deposit.amount).toBe(1000);
    expect(byType.dividend.amount).toBe(12.5);
    expect(byType.tax.amount).toBe(-1.88);
    expect(byType.fee.amount).toBe(-2);
  });
});

describe('mapTransactions', () => {
  it('déduit buy/sell du signe de la quantité', () => {
    const rows = parseCsv(fixture('transactions.csv')).rows;
    const txs = mapTransactions(rows);
    expect(txs).toHaveLength(2);
    const buy = txs.find((t) => t.isin === 'US67066G1040');
    const sell = txs.find((t) => t.isin === 'IE00B4L5Y983');
    expect(buy.type).toBe('buy');
    expect(sell.type).toBe('sell');
    expect(buy.external_id).toBe('abc-123');
  });
});
