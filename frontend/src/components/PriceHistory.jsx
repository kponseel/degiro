import { useMemo, useState } from 'react';
import { fmtEur, fmtNum, fmtPct, fmtDate } from '../lib/format.js';
import { historyStats, WINDOWS } from '../lib/priceHistory.js';
import { useWidth, niceStep, MONTHS } from './Charts.jsx';

const signed = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${fmtPct(x, Math.abs(x) >= 1 ? 0 : 1)}`);
const money = (v, unit) => (unit === 'EUR' ? fmtEur(v) : `${fmtNum(v)} ${unit}`);


/**
 * Courbe du cours en euros, avec deux lignes de repère : ton prix de revient et
 * le niveau choisi dans le tableau. Survol : date et cours au point le plus
 * proche. Un repère hors de l'échelle est signalé en bordure, pas dessiné :
 * l'inclure écraserait la courbe.
 */
function PriceChart({ points, unit, refs }) {
  const [boxRef, width] = useWidth();
  const [hover, setHover] = useState(null);
  const H = 200;
  const M = { top: 12, right: 10, bottom: 22, left: 44 };
  const iw = Math.max(80, width - M.left - M.right);
  const ih = H - M.top - M.bottom;

  const values = points.map((p) => p[1]);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  // Un repère n'élargit l'échelle que s'il reste proche des données.
  const inScale = refs.filter((r) => r.value >= dataMin * 0.6 && r.value <= dataMax * 1.5);
  const lo = Math.min(dataMin, ...inScale.map((r) => r.value));
  const hi = Math.max(dataMax, ...inScale.map((r) => r.value));
  const step = niceStep(hi - lo || hi || 1);
  const y0 = Math.max(0, Math.floor(lo / step) * step);
  const y1 = Math.ceil(hi / step) * step || 1;
  const ticks = [];
  for (let v = y0; v <= y1 + step / 2; v += step) ticks.push(v);

  const t0 = Date.parse(points[0][0]);
  const t1 = Date.parse(points[points.length - 1][0]);
  const x = (day) => M.left + ((Date.parse(day) - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (v) => M.top + ih - ((v - y0) / (y1 - y0)) * ih;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');

  // Graduations du temps : 4 à 6 dates réparties, au format court.
  const spanDays = (t1 - t0) / 86400000;
  const xTicks = [];
  for (let i = 0; i <= 4; i += 1) {
    const t = new Date(t0 + ((t1 - t0) * i) / 4);
    xTicks.push({
      at: M.left + (iw * i) / 4,
      label: spanDays > 400 ? String(t.getUTCFullYear()) : `${MONTHS[t.getUTCMonth()]}${t.getUTCMonth() === 0 ? ` ${String(t.getUTCFullYear()).slice(2)}` : ''}`,
    });
  }

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = t0 + ((px - M.left) / iw) * (t1 - t0);
    let best = 0;
    let gap = Infinity;
    points.forEach((p, i) => {
      const g = Math.abs(Date.parse(p[0]) - t);
      if (g < gap) { gap = g; best = i; }
    });
    setHover(best);
  }

  const last = points[points.length - 1];
  const h = hover != null ? points[hover] : null;
  const label = `Cours de ${fmtDate(points[0][0])} à ${fmtDate(last[0])} : de ${money(points[0][1], unit)} à ${money(last[1], unit)}, plus haut ${money(dataMax, unit)}, plus bas ${money(dataMin, unit)}.`;

  return (
    <div className="ph-chart" ref={boxRef}>
      <svg width={width} height={H} role="img" aria-label={label}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={M.left + iw} y1={y(v)} y2={y(v)} className="ph-grid" />
            <text x={M.left - 6} y={y(v)} className="ph-axis" textAnchor="end" dominantBaseline="middle">{fmtNum(v, step < 1 ? 2 : step % 1 ? 1 : 0)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={t.at} x={t.at} y={H - 6} className="ph-axis" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{t.label}</text>
        ))}

        {inScale.map((r) => (
          <g key={r.key}>
            <line x1={M.left} x2={M.left + iw} y1={y(r.value)} y2={y(r.value)} className="ph-ref" style={{ stroke: r.color }} />
          </g>
        ))}

        <path d={path} className="ph-line" />
        <circle cx={x(last[0])} cy={y(last[1])} r={4} className="ph-dot" />

        {/* Étiquettes des repères, dans le graphique au bout de leur trait (au-dessus,
            ou en dessous si deux repères se touchent). Le texte reste à l'encre ;
            la couleur est portée par la pastille. Un repère hors échelle est
            annoncé en bordure, flèche comprise. */}
        {refs.map((r, i) => {
          const inside = inScale.includes(r);
          const other = refs[1 - i];
          const close = i === 1 && other && inside && inScale.includes(other) && Math.abs(y(other.value) - y(r.value)) < 16;
          const ty = inside
            ? y(r.value) + (close ? 13 : -6)
            : r.value > y1 ? M.top + 10 + i * 14 : M.top + ih - 6 - i * 14;
          const text = `${r.short} ${inside ? '' : r.value > y1 ? '↑ ' : '↓ '}${fmtNum(r.value, r.value < 10 ? 2 : 0)}`;
          return (
            <g key={`l-${r.key}`} pointerEvents="none">
              <text x={M.left + iw - 12} y={ty} textAnchor="end" className="ph-ref-label">{text}</text>
              <circle cx={M.left + iw - 4} cy={ty - 3.5} r={3.5} style={{ fill: r.color }} />
            </g>
          );
        })}

        {h && (
          <g pointerEvents="none">
            <line x1={x(h[0])} x2={x(h[0])} y1={M.top} y2={M.top + ih} className="ph-cross" />
            <circle cx={x(h[0])} cy={y(h[1])} r={4.5} className="ph-dot ph-dot-hover" />
          </g>
        )}
        {/* Zone de survol plus large que la courbe. */}
        <rect x={M.left} y={M.top} width={iw} height={ih} fill="transparent" />
      </svg>
      {h && (
        <div className="ph-tip" style={{ left: Math.min(Math.max(x(h[0]) - 60, 0), width - 130), top: 4 }}>
          <span className="muted">{fmtDate(h[0])}</span>
          <strong>{money(h[1], unit)}</strong>
        </div>
      )}
    </div>
  );
}

const COLUMNS = [
  { key: 'high', label: 'Plus haut', to: 'toHigh' },
  { key: 'avg', label: 'Moyenne', to: 'toAvg' },
  { key: 'low', label: 'Plus bas', to: 'toLow' },
];
const ROWS = [...WINDOWS, { key: 'y5', label: '5 ans' }];

/**
 * Historique du cours d'une position : graphique, repères 3/6/12 mois et 5 ans,
 * et prix de revient. Le repère choisi dans le tableau est tracé sur la courbe.
 */
export default function PriceHistory({ history, fx, position }) {
  const stats = useMemo(() => historyStats(history, fx, position), [history, fx, position]);
  const [range, setRange] = useState('1y');
  const [pick, setPick] = useState({ row: 'm12', col: 'high' });

  if (!history) {
    return (
      <section className="dr-section">
        <h4>Historique du cours</h4>
        <p className="muted dr-note" style={{ marginTop: 0 }}>
          Pas encore d'historique pour cette ligne. Il arrive avec la prochaine capture de l'extension
          (version 0.8 ou plus récente).
        </p>
      </section>
    );
  }
  if (!stats) return null;

  const { unit, now, windows, pru } = stats;
  const points = range === '5y' ? stats.long : stats.series;
  const chosen = windows[pick.row]?.[pick.col];
  const rowLabel = ROWS.find((r) => r.key === pick.row)?.label;
  const refs = [
    pru && { key: 'pru', short: 'PRU', value: pru.level, color: 'var(--c2)' },
    chosen != null && { key: 'pick', short: pick.col === 'avg' ? `Moy. ${rowLabel}` : `${pick.col === 'high' ? 'Haut' : 'Bas'} ${rowLabel}`, value: chosen, color: 'var(--c7)' },
  ].filter(Boolean);

  // Premier repère au-dessus du cours : le niveau le plus proche que le titre a
  // réellement tenu récemment.
  const candidates = [];
  for (const r of ROWS) {
    for (const c of COLUMNS.slice(0, 2)) {
      const v = windows[r.key]?.[c.key];
      if (v > now * 1.005) candidates.push({ label: `${c.label.toLowerCase()} ${r.label}`, value: v });
    }
  }
  const nearest = candidates.sort((a, b) => a.value - b.value)[0];
  const m12 = windows.m12;

  return (
    <section className="dr-section">
      <h4>
        Historique du cours
        <span className="ph-range" role="group" aria-label="Période du graphique">
          {[['1y', '1 an'], ['5y', '5 ans']].map(([k, l]) => (
            <button key={k} type="button" className={`chip filter${range === k ? ' on' : ''}`} aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>
          ))}
        </span>
      </h4>

      {m12 && m12.fromHigh < -0.005 && (
        <p className="dr-note" style={{ marginTop: 0 }}>
          À <strong>{money(now, unit)}</strong>, le cours est à <strong className="neg">{signed(m12.fromHigh)}</strong> de son
          plus haut 12 mois ({money(m12.high, unit)} le {fmtDate(m12.highDate)}).
          {nearest && <> Repère le plus proche au-dessus : <strong>{nearest.label}</strong>, {money(nearest.value, unit)} ({signed(nearest.value / now - 1)}).</>}
        </p>
      )}

      {points.length > 1 && <PriceChart points={points} unit={unit} refs={refs} />}

      <div className="ph-table-wrap">
        <table className="ph-table">
          <caption className="sr-only">Repères de cours et hausse ou baisse nécessaire depuis le cours actuel</caption>
          <thead>
            <tr><th scope="col" />{COLUMNS.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const w = windows[r.key];
              return (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  {COLUMNS.map((c) => {
                    if (!w) return <td key={c.key} className="muted">—</td>;
                    const on = pick.row === r.key && pick.col === c.key;
                    const move = w[c.to];
                    return (
                      <td key={c.key}>
                        <button type="button" className={`ph-cell${on ? ' on' : ''}`} aria-pressed={on}
                          onClick={() => setPick({ row: r.key, col: c.key })}
                          title={`${c.label} ${r.label}${c.key === 'avg' ? '' : ` (le ${fmtDate(w[`${c.key}Date`])})`} — tracer sur le graphique`}>
                          <span className="ph-v">{money(w[c.key], unit)}</span>
                          {/* Neutre : une hausse NÉCESSAIRE n'est pas un gain. */}
                          <span className="ph-m">{signed(move)}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted dr-note">
        Sous chaque niveau : la variation qu'il faudrait depuis le cours actuel pour l'atteindre.
        Touche une case pour la tracer sur le graphique.
      </p>

      {pru && (
        <p className="dr-note">
          <span className="ph-key" style={{ borderColor: 'var(--c2)' }} aria-hidden="true" />
          Ton prix de revient : <strong>{money(pru.level, unit)}</strong>
          {pru.toLevel > 0.005
            ? <> — il faudrait <strong>{signed(pru.toLevel)}</strong> pour y revenir.{' '}
              {pru.lastAbove
                ? <>Dernier passage au-dessus : {fmtDate(pru.lastAbove)}.</>
                : <>Le cours ne l'a jamais atteint depuis {fmtDate(pru.spanFrom)}.</>}</>
            : <> — le cours est au-dessus ({signed(-pru.toLevel / (1 + pru.toLevel))} de marge).</>}
        </p>
      )}

      <p className="muted dr-note">
        {stats.converted
          ? `Cours en ${stats.currency} convertis en euros au taux BCE de chaque jour : l'effet du change est inclus.`
          : unit !== 'EUR'
            ? `Taux de change indisponibles : repères en ${unit}.`
            : 'Cours en euros.'}
        {' '}Source : graphiques DEGIRO, relevés le {fmtDate(history.fetched_at)}.
      </p>
    </section>
  );
}
