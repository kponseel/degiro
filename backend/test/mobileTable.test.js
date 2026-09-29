import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/**
 * Sur téléphone, le tableau des positions (9 colonnes) laisse la place à des
 * cartes ; sur tablette, ses colonnes secondaires (`col-opt`) se masquent. Ce
 * contrat vit à cheval sur le balisage et la feuille de style — une colonne
 * masquée côté cellules mais pas côté en-tête décalerait tout le tableau, et
 * rien à l'exécution ne le signalerait. D'où ces garde-fous sur les sources.
 */
describe('Positions — tableau sur grand écran, cartes sur téléphone', () => {
  const overview = read('../../frontend/src/pages/Overview.jsx');
  const sortHeader = read('../../frontend/src/components/SortHeader.jsx');
  const styles = read('../../frontend/src/styles.css');

  const table = overview.slice(
    overview.indexOf('<table className="data compact positions">'),
    overview.indexOf('</table>'),
  );
  const thead = table.slice(table.indexOf('<thead>'), table.indexOf('</thead>'));
  // La ligne d'une position : celle qui porte `row-click`.
  const row = table.slice(table.indexOf('className="row-click"'), table.indexOf('</tr>', table.indexOf('className="row-click"')));
  const headers = (thead.match(/<SortHeader /g) || []).length;
  const marks = (s) => (s.match(/col-opt/g) || []).length;
  const mediaBlocks = (query) => styles.split(query).slice(1).map((b) => b.slice(0, b.indexOf('\n}')));

  it('le tableau existe, et n’est affiché que sur grand écran', () => {
    expect(table.length).toBeGreaterThan(0);
    expect(overview).toMatch(/className="table-wrap desk-only"/);
    expect(overview).toMatch(/className="pos-cards mobile-only"/);
  });

  it('sous 768 px : tableau masqué, cartes affichées', () => {
    const blocks = mediaBlocks('@media (max-width: 767px)').join('\n');
    expect(blocks).toMatch(/\.desk-only\s*\{\s*display:\s*none/);
    expect(blocks).toMatch(/\.mobile-only\s*\{\s*display:\s*flex/);
    // Hors de ce bloc, les cartes restent cachées.
    expect(styles).toMatch(/\.pos-cards\s*\{\s*display:\s*none/);
  });

  it('ne masque jamais Titre, Valeur ni la plus-value — c’est ce que l’on vient chercher', () => {
    for (const label of ['Titre', 'Valeur', '+/- €', '+/- %']) {
      const line = thead.split('\n').find((l) => l.includes(`label="${label}"`));
      expect(line, `en-tête « ${label} » introuvable`).toBeDefined();
      expect(line, `« ${label} » ne doit pas être masqué`).not.toContain('col-opt');
    }
  });

  it('autant de cellules marquées que d’en-têtes, sinon les colonnes se décalent', () => {
    expect(marks(thead)).toBeGreaterThan(0);
    expect(marks(row)).toBe(marks(thead));
    expect((row.match(/<td/g) || []).length).toBe(headers);
    // Ligne « aucun résultat » : elle couvre toutes les colonnes.
    expect(table).toContain(`colSpan={${headers}}`);
  });

  it('SortHeader propage la classe jusqu’au <th>', () => {
    expect(sortHeader).toMatch(/<th[^>]*className=\{cls\}/);
  });

  it('les colonnes secondaires se masquent sur tablette', () => {
    const blocks = mediaBlocks('@media (max-width: 1099px)').join('\n');
    expect(blocks).toMatch(/table\.positions \.col-opt\s*\{\s*display:\s*none/);
  });
});
