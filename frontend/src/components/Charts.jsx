import { useState } from 'react';
import { fmtEur, fmtPct, fmtSignedEur } from '../lib/format.js';

/**
 * Petits graphiques en HTML/CSS, sans bibliothèque : chaque valeur est écrite en
 * clair à côté de sa marque. La couleur n'est jamais le seul porteur
 * d'information (trois teintes de la palette passent sous 3:1 de contraste sur
 * fond clair : le libellé et le pourcentage visibles compensent), et le texte
 * reste dans les encres du thème, jamais dans la couleur de la série.
 */

// Classes d'actifs → teinte FIXE : la couleur suit l'entité, pas son rang. Une
// classe qui disparaît après un filtre ne repeint pas les autres.
const CLASS_COLOR = {
  Action: 'var(--c1)',
  ETF: 'var(--c2)',
  ETC: 'var(--c3)',
  Fonds: 'var(--c4)',
  Obligation: 'var(--c5)',
  'Liquidités': 'var(--c7)',
  'Action (via ETF)': 'var(--c1)',
};
const NEUTRAL = new Set(['Non typé', 'Non classé', 'ETF non éclatés', 'Liquidités (dans les ETF)']);

/** Couleur d'une classe d'actifs ; gris pour ce qui n'est pas une classification. */
export function classColor(key) {
  if (NEUTRAL.has(key)) return 'var(--ink-faint)';
  return CLASS_COLOR[key] || 'var(--c8)';
}

/**
 * Barre empilée horizontale (partie d'un tout) + légende chiffrée.
 * Chaque segment est séparé par un liseré de la couleur du fond (2 px).
 */
export function StackBar({ items, colorOf = classColor, label }) {
  const visible = items.filter((d) => d.weight > 0);
  return (
    <div className="stackbar-wrap">
      <div className="stackbar" role="img" aria-label={label}>
        {visible.map((d) => (
          <span
            key={d.key}
            className="stackbar-seg"
            style={{ flexGrow: d.weight, background: colorOf(d.key) }}
            title={`${d.key} : ${fmtPct(d.weight)} · ${fmtEur(d.value)}`}
          />
        ))}
      </div>
      <ul className="stackbar-legend">
        {visible.map((d) => (
          <li key={d.key}>
            <span className="legend-dot" style={{ background: colorOf(d.key) }} aria-hidden="true" />
            <span className="sb-key">{d.key}</span>
            <span className="sb-pct">{fmtPct(d.weight)}</span>
            <span className="sb-val muted">{fmtEur(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Jauge 0-100 %, piste dans la même teinte, plus claire. */
export function Meter({ label, value, sub, tone = 'accent' }) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <span className="meter-value">{fmtPct(v)}</span>
      </div>
      <div className={`meter-track ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
        <span className="meter-fill" style={{ width: `${v * 100}%` }} />
      </div>
      {sub && <div className="meter-sub">{sub}</div>}
    </div>
  );
}

/**
 * Liste de barres horizontales (une seule série : une seule teinte), avec
 * dépliage des lignes qui composent chaque catégorie.
 *
 * @param rows   [{ key, value, weight, items? }]
 * @param limit  nombre de catégories visibles avant « Voir tout »
 */
export function BarList({ rows, limit = 8, neutral = NEUTRAL, onItem, emptyText = 'Aucune donnée.' }) {
  const [open, setOpen] = useState(null);
  const [all, setAll] = useState(false);
  if (!rows.length) return <div className="muted">{emptyText}</div>;
  const max = Math.max(...rows.map((r) => r.weight), 0.0001);
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <div className="barlist">
      {shown.map((r) => {
        const isOpen = open === r.key;
        const expandable = r.items?.length > 0;
        return (
          <div key={r.key} className={`bl-row ${isOpen ? 'open' : ''}`}>
            <button
              type="button"
              className="bl-head"
              onClick={() => expandable && setOpen(isOpen ? null : r.key)}
              aria-expanded={expandable ? isOpen : undefined}
              disabled={!expandable}
            >
              <span className="bl-key" title={r.key}>{r.key}</span>
              <span className="bl-track" aria-hidden="true">
                <span className={`bl-fill ${neutral.has(r.key) ? 'neutral' : ''}`} style={{ width: `${(r.weight / max) * 100}%` }} />
              </span>
              <span className="bl-pct">{fmtPct(r.weight)}</span>
              <span className="bl-val">{fmtEur(r.value)}</span>
              {expandable && <span className="bl-chev" aria-hidden="true">›</span>}
            </button>
            {isOpen && (
              <ul className="bl-items">
                {r.items.slice(0, 12).map((it) => (
                  <li key={it.isin || it.name}>
                    {onItem && it.isin ? (
                      <button type="button" className="link-btn bl-item-name" onClick={() => onItem(it)}>{it.name}</button>
                    ) : (
                      <span className="bl-item-name">{it.name}</span>
                    )}
                    {it.viaEtf > 0.005 && <span className="chip sm">{it.direct > 0.005 ? 'direct + ETF' : 'via ETF'}</span>}
                    <span className="bl-item-val">{fmtEur(it.value)}</span>
                    <span className="bl-item-pct muted">{fmtPct(r.value > 0 ? it.value / r.value : 0)}</span>
                  </li>
                ))}
                {r.items.length > 12 && <li className="muted">… et {r.items.length - 12} autres</li>}
              </ul>
            )}
          </div>
        );
      })}
      {rows.length > limit && (
        <button type="button" className="link-btn bl-more" onClick={() => setAll((x) => !x)}>
          {all ? 'Réduire' : `Voir les ${rows.length} catégories`}
        </button>
      )}
    </div>
  );
}

/**
 * Barres divergentes autour d'un zéro central : gains à droite, pertes à gauche.
 * Couleurs de statut (gain / perte), doublées du signe sur chaque valeur.
 */
export function DivergingBars({ rows, onPick, format = fmtSignedEur }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0.0001);
  return (
    <div className="divbars">
      {rows.map((r) => {
        const pos = r.value >= 0;
        const width = `${(Math.abs(r.value) / max) * 50}%`;
        return (
          <button type="button" key={r.key} className="db-row" onClick={() => onPick?.(r)} title={r.label}>
            <span className="db-label">{r.label}</span>
            <span className="db-track" aria-hidden="true">
              <span className="db-axis" />
              <span className={`db-fill ${pos ? 'pos' : 'neg'}`} style={pos ? { left: '50%', width } : { right: '50%', width }} />
            </span>
            <span className={`db-val ${pos ? 'pos' : 'neg'}`}>{format(r.value)}</span>
            {r.sub != null && <span className="db-sub muted">{r.sub}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Carte de chaleur d'un tableau croisé. Une seule teinte, du clair au foncé ;
 * le pourcentage est écrit dans chaque cellule non vide, et l'encre bascule en
 * clair quand le fond devient foncé.
 */
export function Heatmap({ tab, rowLabel = '' }) {
  const { rows, cols, cell, max } = tab;
  if (!rows.length || !cols.length) return null;
  const colTotal = (c) => rows.reduce((s, r) => s + cell(r, c), 0);
  const rowTotal = (r) => cols.reduce((s, c) => s + cell(r, c), 0);
  return (
    <div className="table-wrap">
      <table className="heatmap">
        <thead>
          <tr>
            <th scope="col">{rowLabel}</th>
            {cols.map((c) => <th key={c} scope="col">{c}</th>)}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th scope="row">{r}</th>
              {cols.map((c) => {
                const v = cell(r, c);
                const t = max > 0 ? v / max : 0;
                return (
                  <td
                    key={c}
                    className={t > 0.55 ? 'hm-dark' : ''}
                    style={v > 0 ? { background: `color-mix(in srgb, var(--c1) ${Math.round(8 + t * 82)}%, var(--card))` } : undefined}
                    title={`${r} × ${c} : ${fmtPct(v)}`}
                  >
                    {v >= 0.0005 ? fmtPct(v) : ''}
                  </td>
                );
              })}
              <td className="hm-total">{fmtPct(rowTotal(r))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {cols.map((c) => <td key={c} className="hm-total">{fmtPct(colTotal(c))}</td>)}
            <td className="hm-total">{fmtPct(rows.reduce((s, r) => s + rowTotal(r), 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
