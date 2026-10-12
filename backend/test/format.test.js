import { describe, it, expect } from 'vitest';
import { plural, fmtSignedEur, toneOf, daysBetween, parisToday } from '../../frontend/src/lib/format.js';

// L'interface écrivait « 3 vente(s) ». Ces cas figent l'accord désormais fait par
// le code — et notamment la règle française, qui n'est pas la règle anglaise.
describe('plural', () => {
  it("reste au singulier jusqu'à deux — zéro compris, comme en français", () => {
    expect(plural(0, 'vente')).toBe('0 vente');
    expect(plural(1, 'vente')).toBe('1 vente');
  });

  it('accorde à partir de deux', () => {
    expect(plural(2, 'vente')).toBe('2 ventes');
    expect(plural(12, 'ligne')).toBe('12 lignes');
  });

  it("accepte une forme plurielle explicite quand le « s » ne suffit pas", () => {
    expect(plural(3, 'nouveau mouvement', 'nouveaux mouvements')).toBe('3 nouveaux mouvements');
    expect(plural(1, 'nouveau mouvement', 'nouveaux mouvements')).toBe('1 nouveau mouvement');
    // « flux » est invariable : la forme explicite évite « 3 fluxs ».
    expect(plural(3, 'flux externe', 'flux externes')).toBe('3 flux externes');
  });

  it('formate le nombre à la française', () => {
    const mille = new Intl.NumberFormat('fr-FR').format(1500);
    expect(plural(1500, 'titre')).toBe(`${mille} titres`);
  });

  it('accorde sur la valeur absolue', () => {
    expect(plural(-3, 'vente')).toBe('-3 ventes');
  });
});

// Les deux colonnes « meilleures / moins bonnes » de la vue d'ensemble affichaient
// le même chiffre différemment ; elles partagent maintenant ces deux fonctions.
describe('montants signés', () => {
  // On n'ancre pas la chaîne entière : Intl place une espace insécable étroite avant
  // le symbole monétaire, dont le point de code a changé selon les versions de Node.
  it('marque le gain, laisse la perte porter son propre signe', () => {
    expect(fmtSignedEur(12).startsWith('+12,00')).toBe(true);
    expect(fmtSignedEur(-12).startsWith('-12,00')).toBe(true);
    expect(fmtSignedEur(0).startsWith('+')).toBe(false);
    expect(fmtSignedEur(null)).toBe('—');
  });

  it("ne teinte pas un zéro : ce n'est ni un gain ni une perte", () => {
    expect(toneOf(0)).toBe('');
    expect(toneOf(1)).toBe('pos');
    expect(toneOf(-1)).toBe('neg');
    expect(toneOf(null)).toBe('');
  });
});

describe('âge d’une capture', () => {
  it('compte les jours civils entre deux dates AAAA-MM-JJ', () => {
    expect(daysBetween('2026-10-09', '2026-10-12')).toBe(3);
    expect(daysBetween('2026-10-12', '2026-10-12')).toBe(0);
    // Passage à l'heure d'hiver : toujours un jour entier.
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('pas une date', '2026-10-12')).toBeNull();
  });

  it('donne le jour civil à Paris, pas en UTC', () => {
    // 23 h 30 UTC le 11/10 = 1 h 30 le 12/10 à Paris (heure d'été).
    expect(parisToday(new Date('2026-10-11T23:30:00Z'))).toBe('2026-10-12');
    expect(parisToday(new Date('2026-10-11T12:00:00Z'))).toBe('2026-10-11');
  });
});
