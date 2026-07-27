import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/**
 * Sur téléphone, le tableau des positions ne garde que Titre / Valeur / P-L :
 * les autres colonnes portent `col-opt`, que styles.css masque sous 768 px.
 * Ce contrat vit à cheval sur le balisage et la feuille de style — une colonne
 * masquée côté cellules mais pas côté en-tête décalerait tout le tableau, et
 * rien à l'exécution ne le signalerait. D'où ces garde-fous sur les sources.
 */
describe('Positions — colonnes secondaires sur petit écran', () => {
  const overview = read('../../frontend/src/pages/Overview.jsx');
  const sortHeader = read('../../frontend/src/components/SortHeader.jsx');
  const styles = read('../../frontend/src/styles.css');

  const table = overview.slice(
    overview.indexOf('<table className="data compact">'),
    overview.indexOf('</table>'),
  );
  const thead = table.slice(table.indexOf('<thead>'), table.indexOf('</thead>'));
  const tbody = table.slice(table.indexOf('<tbody>'));
  const headerLine = (label) => thead.split('\n').find((l) => l.includes(`label="${label}"`));
  const marks = (s) => (s.match(/col-opt/g) || []).length;

  it('masque Type, Qté, Cours et Poids', () => {
    for (const label of ['Type', 'Qté', 'Cours', 'Poids']) {
      expect(headerLine(label), `en-tête « ${label} » introuvable`).toBeDefined();
      expect(headerLine(label), `« ${label} » doit porter col-opt`).toContain('cls="col-opt"');
    }
  });

  it('ne masque jamais Titre, Valeur ni P/L — c’est ce que l’on vient chercher', () => {
    for (const label of ['Titre', 'Valeur', 'P/L']) {
      expect(headerLine(label), `en-tête « ${label} » introuvable`).toBeDefined();
      expect(headerLine(label), `« ${label} » ne doit pas être masqué`).not.toContain('col-opt');
    }
  });

  it('autant de cellules marquées que d’en-têtes, sinon les colonnes se décalent', () => {
    expect(marks(thead)).toBe(4);
    expect(marks(tbody)).toBe(marks(thead));
  });

  it('SortHeader propage la classe jusqu’au <th>', () => {
    expect(sortHeader).toMatch(/<th[^>]*className=\{cls\}/);
  });

  it('la feuille de style replie le libellé et masque .col-opt sous 768 px', () => {
    expect(styles).toMatch(
      /table\.data th:first-child, table\.data td:first-child \{ white-space: normal; \}/,
    );
    expect(styles).toContain('@media (max-width: 767px)');
    const block = styles.slice(styles.indexOf('@media (max-width: 767px)'));
    expect(block.slice(0, block.indexOf('\n}'))).toMatch(
      /table\.data \.col-opt\s*\{\s*display:\s*none/,
    );
  });
});
