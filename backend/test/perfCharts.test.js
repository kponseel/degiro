import { describe, it, expect } from 'vitest';
import { echelle, fractionZero, PERIODES, debutDe } from '../../frontend/src/components/PerfCharts.jsx';

describe('Échelle des axes', () => {
  it('resserre les bornes autour des données, avec une marge', () => {
    // Partir de zéro écrasait valeur et capital investi — deux courbes autour de
    // 70 000 € — dans le cinquième supérieur du cadre, rendant invisible l'écart
    // qui est pourtant tout le sujet du graphique.
    const [bas, haut] = echelle([60000, 70000, 80000]);
    expect(bas).toBeLessThan(60000);
    expect(haut).toBeGreaterThan(80000);
    expect(bas).toBeGreaterThan(50000); // resserré, pas ramené à zéro
  });

  it('laisse recharts décider quand il n’y a rien à cadrer', () => {
    // Une série plate donnerait deux bornes confondues : l'axe s'effondrerait.
    expect(echelle([70000, 70000])).toBeUndefined();
    expect(echelle([42])).toBeUndefined();
    expect(echelle([])).toBeUndefined();
    expect(echelle(null)).toBeUndefined();
  });

  it('ne prend pas un trou de données pour un zéro', () => {
    // `Number(null)` vaut 0 : un `map(Number)` naïf aurait ramené la borne basse
    // à l'origine, exactement le cadrage qu'on cherche à éviter.
    expect(echelle([100, null, 200, undefined, NaN, ''])).toEqual([94, 206]);
  });
});

describe('Césure du dégradé sur le zéro', () => {
  it('place le zéro à sa hauteur réelle dans le cadre', () => {
    // +100 en haut, -100 en bas ⇒ le zéro est au milieu.
    expect(fractionZero([100, -100])).toBeCloseTo(0.5, 6);
    // +300 en haut, -100 en bas ⇒ zéro aux trois quarts de la hauteur.
    expect(fractionZero([300, 0, -100])).toBeCloseTo(0.75, 6);
  });

  it('ne coupe rien quand la série garde un seul signe', () => {
    // Une aire entièrement positive n'a pas de partie rouge à dessiner : la
    // césure n'aurait pas de sens, et le dégradé reste d'une seule couleur.
    expect(fractionZero([10, 20, 30])).toBeNull();
    expect(fractionZero([-10, -20])).toBeNull();
    expect(fractionZero([])).toBeNull();
  });

  it('ne déclenche pas de rouge sur un simple trou de données', () => {
    // Un `null` compté comme 0 aurait fait croire à un passage par zéro et
    // teinté de rouge une courbe pourtant toujours bénéficiaire.
    expect(fractionZero([10, null, 30])).toBeNull();
  });
});

describe('Périodes affichables', () => {
  const dernier = '2026-07-27';

  it('recule du bon nombre de mois', () => {
    expect(debutDe(PERIODES.find((p) => p.key === '1m'), dernier)).toBe('2026-06-27');
    expect(debutDe(PERIODES.find((p) => p.key === '6m'), dernier)).toBe('2026-01-27');
    expect(debutDe(PERIODES.find((p) => p.key === '1a'), dernier)).toBe('2025-07-27');
  });

  it('« Depuis janvier » part du 1er janvier de l’année en cours', () => {
    expect(debutDe(PERIODES.find((p) => p.key === 'ytd'), dernier)).toBe('2026-01-01');
  });

  it('« Tout » ne pose aucune borne', () => {
    expect(debutDe(PERIODES.find((p) => p.key === 'all'), dernier)).toBeNull();
    expect(debutDe(PERIODES[0], null)).toBeNull();
  });

  it('franchit correctement une frontière d’année', () => {
    expect(debutDe(PERIODES.find((p) => p.key === '3m'), '2026-02-15')).toBe('2025-11-15');
  });
});
