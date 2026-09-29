import { useEffect, useMemo, useState } from 'react';
import { getPortfolio, getLookthrough } from '../lib/api.js';
import { fmtEur, fmtPct, fmtNum, fmtDate, fmtSignedEur, toneOf, plural } from '../lib/format.js';
import { Spinner, Card, Banner, Empty } from '../components/ui.jsx';
import FilterBar from '../components/FilterBar.jsx';
import PositionDrawer from '../components/PositionDrawer.jsx';
import { StackBar, Meter, DivergingBars } from '../components/Charts.jsx';
import { usePersistentState, distinctValues, applyFilters } from '../lib/useFilters.js';
import { useSort } from '../lib/useSort.js';
import SortHeader from '../components/SortHeader.jsx';
import {
  analyzePortfolio, attentionPoints, breakdown, hasLookthrough, linesToCsv, UNCLASSIFIED,
} from '../lib/portfolioAnalytics.js';

const EMPTY_FILTER = { q: '', type: '', sector: '', country: '', group: '' };

const GROUPS = [
  { value: '', label: 'Sans regroupement' },
  { value: 'type', label: 'Par classe d’actifs' },
  { value: 'sectorN', label: 'Par secteur' },
  { value: 'region', label: 'Par région' },
  { value: 'currency', label: 'Par devise' },
];

const signedPct = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${fmtPct(x)}`);

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${tone || ''}`}>{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

/** Constats chiffrés ; chacun peut filtrer le tableau sur les lignes concernées. */
function AttentionList({ points, onFocus, onRoute }) {
  if (!points.length) {
    return <div className="muted">Rien de saillant : aucune ligne ni aucun secteur ne dépasse les seuils suivis.</div>;
  }
  return (
    <ul className="attn-list">
      {points.map((p) => (
        <li key={p.id} className={`attn attn-${p.level}`}>
          <span className="attn-icon" aria-hidden="true">{p.level === 'warn' ? '!' : 'i'}</span>
          <div className="attn-body">
            <div className="attn-title">{p.title}</div>
            <div className="attn-detail">{p.detail}</div>
          </div>
          <div className="attn-actions">
            {p.isins?.length > 0 && (
              <button type="button" className="btn ghost sm" onClick={() => onFocus(p)}>
                Voir {p.isins.length > 1 ? `les ${p.isins.length} lignes` : 'la ligne'}
              </button>
            )}
            {!p.isins?.length && p.route && (
              <button type="button" className="btn ghost sm" onClick={() => onRoute(p.route)}>
                {p.route === 'import' ? 'Import / Extension' : 'Voir l’exposition'}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Carte d'une position, pour les petits écrans (le tableau à 9 colonnes n'y tient pas). */
function PositionCard({ l, onSelect }) {
  return (
    <button type="button" className="pos-card" onClick={() => onSelect(l)}>
      <span className="pc-top">
        <span className="pc-name">{l.name || l.isin}</span>
        <span className="pc-value">{fmtEur(l.value)}</span>
      </span>
      <span className="pc-meta">
        <span className="muted">{[l.ticker || l.symbol, l.type, l.sectorN].filter(Boolean).join(' · ')}</span>
        {l.plPct != null && <span className={toneOf(l.pl)}>{signedPct(l.plPct)}</span>}
      </span>
      <span className="pc-weight">
        <span className="wbar" aria-hidden="true"><span style={{ width: `${Math.min(100, l.w * 100 * 4)}%` }} /></span>
        <span className="muted">{fmtPct(l.w)} des titres</span>
        {l.dayPct != null && <span className={`pc-day ${toneOf(l.day)}`}>jour {signedPct(l.dayPct)}</span>}
      </span>
    </button>
  );
}

function downloadCsv(lines, date) {
  // BOM : sans lui, Excel lit l'UTF-8 comme du Latin-1 et « Énergie » devient illisible.
  const blob = new Blob(['﻿', linesToCsv(lines)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `portefeuille-${date || 'export'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Overview({ onGoImport }) {
  const [data, setData] = useState(null);
  const [lookthrough, setLookthrough] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = usePersistentState('degiro_filter_overview', EMPTY_FILTER);
  // Filtre ponctuel posé par un point d'attention : non mémorisé d'une visite à l'autre.
  const [focus, setFocus] = useState(null);

  useEffect(() => {
    getPortfolio().then(setData).catch((e) => setError(e.message));
    getLookthrough().then(setLookthrough).catch(() => setLookthrough(null));
  }, []);

  const a = useMemo(() => (data?.snapshot ? analyzePortfolio(data) : null), [data]);
  const points = useMemo(() => {
    if (!a) return [];
    const lt = hasLookthrough(lookthrough) ? lookthrough : null;
    return attentionPoints(a, { lookthrough: lt, sectors: breakdown(a.lines, 'sector', lt) });
  }, [a, lookthrough]);

  const lines = a?.lines || [];
  const focusSet = focus ? new Set(focus.isins) : null;
  const filtered = applyFilters(focusSet ? lines.filter((l) => focusSet.has(l.isin)) : lines, filter, {
    searchFields: ['name', 'symbol', 'ticker', 'isin'],
    facetGetters: { type: (l) => l.type, sector: (l) => l.sectorN || '', country: (l) => l.countryN || '' },
  });
  const { sorted, sort, toggle } = useSort(filtered, { key: 'value', dir: 'desc' }, {
    name: (l) => l.name || l.isin,
  });

  const groups = useMemo(() => {
    if (!filter.group) return [{ key: null, lines: sorted }];
    const m = new Map();
    for (const l of sorted) {
      const k = l[filter.group] || UNCLASSIFIED;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(l);
    }
    return [...m.entries()]
      .map(([key, ls]) => ({ key, lines: ls, value: ls.reduce((s, l) => s + l.value, 0) }))
      .sort((x, y) => y.value - x.value);
  }, [sorted, filter.group]);

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!data) return <Spinner />;

  if (!data.snapshot) {
    return (
      <Card>
        <Empty title="Aucune donnée pour l'instant">
          Importe un export DEGIRO (Portfolio.csv) ou fais une capture avec l'extension pour voir ton portefeuille.
          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={onGoImport}>Importer mon portefeuille</button>
          </div>
        </Empty>
      </Card>
    );
  }

  const { concentration: c } = a;
  const setF = (k) => (v) => setFilter((f) => ({ ...f, [k]: v }));
  const facets = [
    { key: 'type', label: 'Type', value: filter.type, options: distinctValues(lines, (l) => l.type), onChange: setF('type') },
    { key: 'sector', label: 'Secteur', value: filter.sector, options: distinctValues(lines, (l) => l.sectorN), onChange: setF('sector') },
    { key: 'country', label: 'Pays', value: filter.country, options: distinctValues(lines, (l) => l.countryN), onChange: setF('country') },
  ];
  const focusOn = (p) => {
    setFocus({ label: p.title, isins: p.isins });
    setTimeout(() => document.getElementById('positions')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };
  const route = (r) => { window.location.hash = `#/${r}`; };
  const pick = (isin) => setSelected(lines.find((l) => l.isin === isin) || null);

  const contrib = [...a.gainers.slice(0, 5), ...a.losers.slice(0, 5).reverse()]
    .map((l) => ({ key: l.isin, label: l.name || l.isin, value: l.pl, sub: signedPct(l.plPct) }));
  const movers = [...a.dayUp.slice(0, 4), ...a.dayDown.slice(0, 4).reverse()]
    .map((l) => ({ key: l.isin, label: l.name || l.isin, value: l.day, sub: signedPct(l.dayPct) }));
  const source = a.snapshot.source === 'extension' ? 'capture extension' : 'import CSV';

  return (
    <>
      <div className="kpi-strip ana-kpis">
        <Kpi label="Valeur totale" value={fmtEur(a.total)} sub={`au ${fmtDate(a.snapshot.snapshot_date)} · ${source}`} />
        <Kpi label="Titres" value={fmtEur(a.invested)} sub={a.pl ? `coût ${fmtEur(a.pl.cost)}${a.pl.coverage < 0.999 ? ' (lignes connues)' : ''}` : plural(c.n, 'ligne')} />
        <Kpi
          label="+/- value latente"
          value={a.pl ? fmtSignedEur(a.pl.total) : '—'}
          sub={a.pl ? `${signedPct(a.pl.pct)} du coût` : 'non fournie par Portfolio.csv'}
          tone={a.pl ? toneOf(a.pl.total) : ''}
        />
        <Kpi
          label="Variation du jour"
          value={a.day ? fmtSignedEur(a.day.total) : '—'}
          sub={a.day ? signedPct(a.day.pct) : 'capture extension requise'}
          tone={a.day ? toneOf(a.day.total) : ''}
        />
        <Kpi label="Liquidités" value={fmtEur(a.cash)} sub={a.cashShare != null ? `${fmtPct(a.cashShare)} du patrimoine` : null} />
        <Kpi
          label="Diversification"
          value={`${fmtNum(c.effective, 1)} lignes`}
          sub={`effectives sur ${c.n} détenues`}
        />
      </div>

      <div className="ana-grid-2">
        <Card title="Allocation du patrimoine">
          <StackBar items={a.allocation} label="Répartition du patrimoine par classe d'actifs" />
          <div className="ana-facts">
            <span><strong>{fmtPct(a.funds)}</strong> des titres en ETF / fonds</span>
            <span><strong>{fmtPct(a.nonEurShare)}</strong> cotés hors euro</span>
          </div>
        </Card>

        <Card title="Concentration">
          <div className="meters">
            <Meter label="Première ligne" value={c.top1} />
            <Meter label="5 premières lignes" value={c.top5} />
            <Meter label="10 premières lignes" value={c.top10} />
          </div>
          <p className="ana-note">
            {c.n} lignes, mais une concentration équivalente à <strong>{fmtNum(c.effective, 1)}</strong> lignes
            de même poids{a.dust.count ? ` · ${plural(a.dust.count, 'ligne')} sous 1 % (${fmtPct(a.dust.share)} au total)` : ''}.
          </p>
        </Card>
      </div>

      <Card title="Points d'attention" className="ana-block">
        <AttentionList points={points} onFocus={focusOn} onRoute={route} />
      </Card>

      {(contrib.length > 0 || movers.length > 0) && (
        <div className="ana-grid-2">
          {contrib.length > 0 && (
            <Card title="Ce qui fait ta +/- value">
              <DivergingBars rows={contrib} onPick={(r) => pick(r.key)} />
              <p className="ana-note">Les 5 plus fortes contributions de chaque côté, en euros de plus-value latente.</p>
            </Card>
          )}
          {movers.length > 0 && (
            <Card title="Mouvements du jour">
              <DivergingBars rows={movers} onPick={(r) => pick(r.key)} />
              <p className="ana-note">Variation depuis la clôture précédente, à la dernière capture.</p>
            </Card>
          )}
        </div>
      )}

      <Card title="Positions" className="ana-block">
        <div id="positions" />
        <FilterBar
          q={filter.q}
          onQ={setF('q')}
          facets={facets}
          onReset={() => { setFilter(EMPTY_FILTER); setFocus(null); }}
          count={sorted.length}
          total={lines.length}
          placeholder="Titre, ticker, ISIN…"
        />
        <div className="table-tools">
          <select className="input filter-select" value={filter.group} onChange={(e) => setF('group')(e.target.value)} aria-label="Regrouper">
            {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
          {focus && (
            <span className="chip filter on focus-chip">
              {focus.label}
              <button type="button" onClick={() => setFocus(null)} aria-label="Retirer ce filtre">✕</button>
            </span>
          )}
          <button type="button" className="btn ghost sm tools-end" onClick={() => downloadCsv(sorted, a.snapshot.snapshot_date)}>
            Exporter en CSV
          </button>
        </div>

        <div className="table-wrap desk-only">
          <table className="data compact positions">
            <thead>
              <tr>
                <SortHeader label="Titre" colKey="name" sort={sort} onToggle={toggle} align="left" />
                <SortHeader label="Qté" colKey="qty" sort={sort} onToggle={toggle} cls="col-opt" />
                <SortHeader label="Cours" colKey="price" sort={sort} onToggle={toggle} cls="col-opt" />
                <SortHeader label="PRU" colKey="break_even_price" sort={sort} onToggle={toggle} cls="col-opt" />
                <SortHeader label="Valeur" colKey="value" sort={sort} onToggle={toggle} />
                <SortHeader label="Poids" colKey="w" sort={sort} onToggle={toggle} />
                <SortHeader label="+/- €" colKey="pl" sort={sort} onToggle={toggle} />
                <SortHeader label="+/- %" colKey="plPct" sort={sort} onToggle={toggle} />
                <SortHeader label="Jour" colKey="dayPct" sort={sort} onToggle={toggle} cls="col-opt" />
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key ?? 'all'}>
                {g.key != null && (
                  <tr className="group-row">
                    <th colSpan={4} scope="rowgroup">{g.key} <span className="muted">· {plural(g.lines.length, 'ligne')}</span></th>
                    <td>{fmtEur(g.value)}</td>
                    <td>{fmtPct(a.invested > 0 ? g.value / a.invested : 0)}</td>
                    <td colSpan={3} />
                  </tr>
                )}
                {g.lines.map((l) => (
                  <tr key={l.isin} className="row-click" onClick={() => setSelected(l)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(l); } }}>
                    <td className="col-titre">
                      <div className="pos-name">{l.name || l.isin}</div>
                      <div className="pos-sub muted">{[l.ticker || l.symbol, l.type, l.sectorN].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="col-opt">{fmtNum(l.qty, Number.isInteger(Number(l.qty)) ? 0 : 2)}</td>
                    <td className="col-opt">{fmtNum(l.price)} <span className="muted sm">{l.currency}</span></td>
                    <td className="col-opt">{l.break_even_price != null ? fmtNum(l.break_even_price) : <span className="muted">—</span>}</td>
                    <td className="sym">{fmtEur(l.value)}</td>
                    <td>
                      <span className="wcell">
                        <span className="wbar" aria-hidden="true"><span style={{ width: `${Math.min(100, (l.w / Math.max(c.top1, 0.0001)) * 100)}%` }} /></span>
                        {fmtPct(l.w)}
                      </span>
                    </td>
                    <td className={l.pl == null ? 'muted' : toneOf(l.pl)}>{fmtSignedEur(l.pl)}</td>
                    <td className={l.plPct == null ? 'muted' : toneOf(l.pl)}>{signedPct(l.plPct)}</td>
                    <td className={`col-opt ${l.dayPct == null ? 'muted' : toneOf(l.day)}`}>{signedPct(l.dayPct)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
            {sorted.length === 0 && (
              <tbody>
                <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 18 }}>Aucune position ne correspond aux filtres.</td></tr>
              </tbody>
            )}
          </table>
        </div>

        <div className="pos-cards mobile-only">
          {groups.map((g) => (
            <div key={g.key ?? 'all'} className="pc-group">
              {g.key != null && (
                <div className="pc-group-head">
                  <span>{g.key}</span>
                  <span className="muted">{fmtEur(g.value)} · {fmtPct(a.invested > 0 ? g.value / a.invested : 0)}</span>
                </div>
              )}
              {g.lines.map((l) => <PositionCard key={l.isin} l={l} onSelect={setSelected} />)}
            </div>
          ))}
          {sorted.length === 0 && <div className="muted" style={{ padding: 12 }}>Aucune position ne correspond aux filtres.</div>}
        </div>

        <div className="sub muted" style={{ marginTop: 10, fontSize: 12.5 }}>
          Poids en part de la valeur des titres (hors liquidités). Clique une ligne pour son détail.
        </div>
      </Card>

      <PositionDrawer
        position={selected}
        lookthrough={lookthrough}
        onAnalyze={(p) => { window.location.hash = `#/ai?isin=${encodeURIComponent(p.isin)}`; }}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
