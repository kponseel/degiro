import { describe, it, expect } from 'vitest';
import {
  sectorColorIndex, distinctSectors,
} from '../../frontend/src/lib/newsFilter.js';

const stocks = [
  { isin: 'US1', name: 'A', sector: 'Technologie' },
  { isin: 'US2', name: 'B', sector: 'Technologie' },
  { isin: 'FR1', name: 'C', sector: 'Santé' },
  { isin: 'FR2', name: 'D', sector: null },
];

describe('couleur de secteur', () => {
  it('est déterministe et dans la plage 1..8', () => {
    for (const s of ['Technologie', 'Santé', 'Finance', 'Énergie', 'Industrie']) {
      const i = sectorColorIndex(s);
      expect(i).toBeGreaterThanOrEqual(1);
      expect(i).toBeLessThanOrEqual(8);
      expect(sectorColorIndex(s)).toBe(i); // stable
    }
  });

  it('secteur vide/inconnu → 0 (neutre)', () => {
    expect(sectorColorIndex(null)).toBe(0);
    expect(sectorColorIndex('')).toBe(0);
    expect(sectorColorIndex('  ')).toBe(0);
  });

  it('insensible à la casse et aux espaces', () => {
    expect(sectorColorIndex('Technologie')).toBe(sectorColorIndex(' technologie '));
  });
});

describe('secteurs distincts', () => {
  it('dédoublonne, ignore les vides, trie', () => {
    expect(distinctSectors(stocks)).toEqual(['Santé', 'Technologie']);
    expect(distinctSectors([])).toEqual([]);
  });
});
