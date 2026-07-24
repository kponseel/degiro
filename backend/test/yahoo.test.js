import { describe, it, expect } from 'vitest';
import { mapSectorToFr, pickEquityQuote } from '../src/services/yahoo.js';

describe('Yahoo — normalisation des secteurs', () => {
  it('traduit les secteurs Yahoo en français', () => {
    expect(mapSectorToFr('Technology')).toBe('Technologie');
    expect(mapSectorToFr('Financial Services')).toBe('Finance');
    expect(mapSectorToFr('Consumer Cyclical')).toBe('Consommation cyclique');
    expect(mapSectorToFr('Healthcare')).toBe('Santé');
    expect(mapSectorToFr('REAL ESTATE')).toBe('Immobilier'); // insensible à la casse
  });

  it('renvoie le secteur tel quel si inconnu, null si vide', () => {
    expect(mapSectorToFr('Crypto')).toBe('Crypto');
    expect(mapSectorToFr(null)).toBeNull();
    expect(mapSectorToFr('')).toBeNull();
  });
});

describe('Yahoo — extraction du meilleur résultat action', () => {
  it('choisit l’action avec secteur et le traduit', () => {
    const json = {
      quotes: [
        { quoteType: 'ETF', symbol: 'CSPX.L', shortname: 'iShares S&P 500' },
        { quoteType: 'EQUITY', symbol: 'BABA', sectorDisp: 'Consumer Cyclical', industryDisp: 'Internet Retail' },
      ],
    };
    const q = pickEquityQuote(json);
    expect(q.symbol).toBe('BABA');
    expect(q.sector).toBe('Consommation cyclique');
    expect(q.industry).toBe('Internet Retail');
  });

  it('repli sur la première action même sans secteur', () => {
    const q = pickEquityQuote({ quotes: [{ quoteType: 'EQUITY', symbol: 'ATO.PA' }] });
    expect(q.symbol).toBe('ATO.PA');
    expect(q.sector).toBeNull();
  });

  it('renvoie null quand il n’y a aucune action (ETF pur, ou vide)', () => {
    expect(pickEquityQuote({ quotes: [{ quoteType: 'ETF', symbol: 'X' }] })).toBeNull();
    expect(pickEquityQuote({ quotes: [] })).toBeNull();
    expect(pickEquityQuote({})).toBeNull();
  });
});
