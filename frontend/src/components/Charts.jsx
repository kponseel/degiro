import { useLayoutEffect, useRef, useState } from 'react';
import { fmtEur, fmtPct, fmtSignedEur, fmtNum, fmtDate } from '../lib/format.js';

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

// ── Courbes dans le temps ─────────────────────────────────────────────

/** Largeur réelle du conteneur : le graphique se redessine au lieu d'être étiré. */
export function useWidth(fallback = 360) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.clientWidth || fallback);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}

/** Pas « rond » de graduation pour environ quatre intervalles. */
export const niceStep = (span) => {
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || raw;
};

export const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * Graduations du temps sur des dates rondes : débuts d'année (plus de 18 mois),
 * débuts de mois (plus de 45 jours), sinon jours. Au plus six, jamais deux fois
 * la même étiquette.
 */
export function timeTicks(t0, t1) {
  const span = (t1 - t0) / 86400000;
  const out = [];
  const d = new Date(t0);
  if (span > 540) {
    for (let y = d.getUTCFullYear() + 1; Date.UTC(y, 0, 1) <= t1; y += 1) out.push({ t: Date.UTC(y, 0, 1), label: String(y) });
  } else if (span > 45) {
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth() + 1;
    for (; Date.UTC(y, m, 1) <= t1; m += 1) {
      if (m > 11) { m = 0; y += 1; }
      const t = Date.UTC(y, m, 1);
      if (t > t1) break;
      out.push({ t, label: `${MONTHS[m]}${m === 0 ? ` ${String(y).slice(2)}` : ''}` });
    }
  } else {
    const step = Math.max(1, Math.ceil(span / 5));
    for (let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); t <= t1; t += step * 86400000) {
      out.push({ t, label: fmtDate(new Date(t).toISOString().slice(0, 10)).slice(0, 5) });
    }
  }
  if (out.length <= 6) return out;
  const every = Math.ceil(out.length / 6);
  return out.filter((_, i) => i % every === 0);
}

/** Graduation compacte en euros : 85 k, 1,2 M. */
const compactEur = (v) => (Math.abs(v) >= 1e6 ? `${fmtNum(v / 1e6, 1)} M` : Math.abs(v) >= 1e4 ? `${fmtNum(v / 1e3, 0)} k` : fmtNum(v, 0));

/**
 * Courbes sur un même axe (une seule échelle, en euros), avec légende et survol.
 *
 * @param series [{ key, label, color, points: [[jour, valeur], …], step?, dashed? }]
 *   `step` : tracé en escalier (un montant qui change par à-coups, comme des
 *   versements) ; la première série est la principale.
 */
export function TimeChart({ series, height = 220, format = fmtEur, label }) {
  const [boxRef, width] = useWidth(600);
  const [hover, setHover] = useState(null);
  const visible = series.filter((s) => s.points.length);
  if (!visible.length) return null;
  const M = { top: 12, right: 12, bottom: 22, left: 48 };
  const iw = Math.max(80, width - M.left - M.right);
  const ih = height - M.top - M.bottom;

  const all = visible.flatMap((s) => s.points);
  const values = all.map((p) => p[1]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const step = niceStep(hi - lo || Math.abs(hi) || 1);
  const y0 = Math.floor(lo / step) * step;
  const y1 = Math.ceil(hi / step) * step === y0 ? y0 + step : Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = y0; v <= y1 + step / 2; v += step) ticks.push(v);

  const days = [...new Set(all.map((p) => p[0]))].sort();
  const t0 = Date.parse(days[0]);
  const t1 = Date.parse(days[days.length - 1]);
  const x = (day) => M.left + ((Date.parse(day) - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (v) => M.top + ih - ((v - y0) / (y1 - y0)) * ih;
  const pathOf = (s) => s.points.map((p, i) => {
    if (!i) return `M${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`;
    return s.step
      ? `H${x(p[0]).toFixed(1)}V${y(p[1]).toFixed(1)}`
      : `L${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`;
  }).join('');

  const xTicks = timeTicks(t0, t1).map((t) => ({ ...t, at: M.left + ((t.t - t0) / Math.max(1, t1 - t0)) * iw }));

  /** Valeur d'une série au jour `day` : le dernier point connu à cette date. */
  const at = (s, day) => {
    let v = null;
    for (const p of s.points) { if (p[0] <= day) v = p[1]; else break; }
    return v;
  };

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - rect.left - M.left) / iw) * (t1 - t0);
    let best = days[0];
    let gap = Infinity;
    for (const d of days) {
      const g = Math.abs(Date.parse(d) - t);
      if (g < gap) { gap = g; best = d; }
    }
    setHover(best);
  }

  const few = visible[0].points.length <= 40;

  return (
    <div className="tc-wrap">
      {visible.length > 1 && (
        <div className="tc-legend">
          {visible.map((s) => (
            <span key={s.key} className="tc-key">
              <svg width="18" height="8" aria-hidden="true"><line x1="1" x2="17" y1="4" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} /></svg>
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="tc-chart" ref={boxRef}>
        <svg width={width} height={height} role="img" aria-label={label}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={M.left + iw} y1={y(v)} y2={y(v)} className="ph-grid" />
              <text x={M.left - 6} y={y(v)} className="ph-axis" textAnchor="end" dominantBaseline="middle">{compactEur(v)}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t.t} x={t.at} y={height - 6} className="ph-axis"
              textAnchor={t.at < M.left + 16 ? 'start' : t.at > M.left + iw - 16 ? 'end' : 'middle'}>{t.label}</text>
          ))}
          {visible.map((s) => (
            <path key={s.key} d={pathOf(s)} fill="none" stroke={s.color} strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
          ))}
          {few && visible[0].points.map((p) => (
            <circle key={p[0]} cx={x(p[0])} cy={y(p[1])} r={2.5} fill={visible[0].color} />
          ))}
          {visible.map((s) => {
            const last = s.points[s.points.length - 1];
            return <circle key={`e-${s.key}`} cx={x(last[0])} cy={y(last[1])} r={4} className="tc-end" style={{ fill: s.color }} />;
          })}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} className="ph-cross" />
              {visible.map((s) => {
                const v = at(s, hover);
                return v == null ? null : <circle key={`h-${s.key}`} cx={x(hover)} cy={y(v)} r={4.5} className="tc-end" style={{ fill: s.color }} />;
              })}
            </g>
          )}
          <rect x={M.left} y={M.top} width={iw} height={ih} fill="transparent" />
        </svg>
        {hover && (
          <div className="ph-tip" style={{ left: Math.min(Math.max(x(hover) - 70, 0), width - 170), top: 4 }}>
            <span className="muted">{fmtDate(hover)}</span>
            {visible.map((s) => {
              const v = at(s, hover);
              return v == null ? null : (
                <span key={s.key} className="tc-tip-row">
                  <span className="tc-dot" style={{ background: s.color }} aria-hidden="true" />
                  {s.label} <strong>{format(v)}</strong>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
