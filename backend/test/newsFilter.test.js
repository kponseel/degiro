import { describe, it, expect } from 'vitest';
import {
  sectorColorIndex, distinctSectors, filterNews, toggleInSet,
} from '../../frontend/src/lib/newsFilter.js';

const items = [
  { isin: 'US1', sector: 'Technologie', title: 'a' },
  { isin: 'US2', sector: 'Technologie', title: 'b' },
  { isin: 'FR1', sector: 'Santé', title: 'c' },
  { isin: 'FR2', sector: null, title: 'd' },
];
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

describe('filtre multi-sélection', () => {
  it('sans sélection → tout', () => {
    expect(filterNews(items, new Set(), new Set())).toHaveLength(4);
  });

  it('OU à l’intérieur d’une dimension (plusieurs titres)', () => {
    const r = filterNews(items, new Set(['US1', 'FR1']), new Set());
    expect(r.map((i) => i.isin)).toEqual(['US1', 'FR1']);
  });

  it('filtre par secteur (multi)', () => {
    const r = filterNews(items, new Set(), new Set(['Technologie']));
    expect(r.map((i) => i.isin)).toEqual(['US1', 'US2']);
  });

  it('ET entre dimensions : titre ET secteur doivent coller', () => {
    // FR1 est en Santé : sélectionner secteur Technologie l'exclut.
    const r = filterNews(items, new Set(['US1', 'FR1']), new Set(['Technologie']));
    expect(r.map((i) => i.isin)).toEqual(['US1']);
  });

  it('combinaison sans intersection → vide', () => {
    expect(filterNews(items, new Set(['FR2']), new Set(['Technologie']))).toHaveLength(0);
  });
});

describe('bascule dans un Set (immutable)', () => {
  it('ajoute, retire, et ne mute pas l’original', () => {
    const a = new Set(['x']);
    const b = toggleInSet(a, 'y');
    expect([...b].sort()).toEqual(['x', 'y']);
    expect([...a]).toEqual(['x']); // inchangé
    const c = toggleInSet(b, 'x');
    expect([...c]).toEqual(['y']);
  });
});
