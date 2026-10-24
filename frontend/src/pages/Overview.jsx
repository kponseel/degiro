import { useEffect, useMemo, useState } from 'react';
import { getPortfolio, getLookthrough, getHistory } from '../lib/api.js';
import { evolution, RANGES } from '../lib/evolution.js';
import { fmtEur, fmtPct, fmtNum, fmtDate, fmtDateShort, fmtSignedEur, toneOf, plural, parisToday, daysBetween } from '../lib/format.js';
import { Spinner, Card, Banner, Empty } from '../components/ui.jsx';
import FilterBar from '../components/FilterBar.jsx';
import PositionDrawer from '../components/PositionDrawer.jsx';
import { StackBar, Meter, DivergingBars, TimeChart } from '../components/Charts.jsx';
import { usePersistentState, distinctValues, applyFilters } from '../lib/useFilters.js';
import { useSort } from '../lib/useSort.js';
import { usePrices } from '../lib/usePrices.js';
import { historyStats } from '../lib/priceHistory.js';
import SortHeader from '../components/SortHeader.jsx';
import { diffSnapshots } from '../lib/snapshotDiff.js';
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

/**
 * « Depuis ta capture du JJ/MM » : effet marché à quantité constante, et tes
 * décisions (lignes nouvelles, soldées, renforcées ou allégées), séparément.
 * Chaque puce filtre le tableau sur les lignes concernées.
 */
function SinceLast({ d, onFocus, onPick }) {
  const title = `Depuis ta capture du ${fmtDate(d.since)}${d.days != null ? ` (${plural(d.days, 'jour')})` : ''}`;
  if (d.suspect) {
    const s = d.suspect;
    return (
      <Card title={title} className="ana-block">
        <p className="since-suspect">
          <strong>Capture probablement incomplète</strong> : {plural(s.lines, 'ligne')} et {fmtEur(s.total)}
          {' '}contre {plural(s.previousLines, 'ligne')} et {fmtEur(s.previousTotal)} le {fmtDate(d.since)}.
          {' '}DEGIRO n'avait sans doute pas fini de charger. Recharge l'onglet DEGIRO, puis relance une capture
          depuis l'extension : elle remplacera celle-ci.
        </p>
      </Card>
    );
  }
  const movers = [...d.up, ...[...d.down].reverse()]
    .map((m) => ({ key: m.isin, label: m.name, value: m.move, sub: m.pct == null ? '' : signedPct(m.pct) }));
  const chips = [
    d.added.length && { label: `${plural(d.added.length, 'nouvelle ligne', 'nouvelles lignes')}`, isins: d.added.map((x) => x.isin), title: 'Nouvelles lignes' },
    d.closed.length && { label: `${plural(d.closed.length, 'ligne soldée', 'lignes soldées')}`, names: d.closed.map((x) => x.name) },
    d.resized.length && {
      label: `${plural(d.resized.length, 'quantité modifiée', 'quantités modifiées')}`
        + (d.resized.some((r) => r.approx != null) ? ` (≈ ${fmtSignedEur(d.resized.reduce((s2, r) => s2 + (r.approx || 0), 0))})` : ''),
      isins: d.resized.map((x) => x.isin),
      title: 'Quantités modifiées',
    },
    ...d.crossings.map((c) => ({
      label: `${c.name} ${c.up ? 'passe' : 'repasse sous'} ${Math.round(c.threshold * 100)} %`,
      isins: [c.isin],
      title: `${c.name} : seuil ${Math.round(c.threshold * 100)} %`,
    })),
  ].filter(Boolean);
  return (
    <Card title={title} className="ana-block">
      <div className="since-figs">
        {d.totalDelta != null && (
          <span>Valeur totale <strong className={toneOf(d.totalDelta)}>{fmtSignedEur(d.totalDelta)}</strong>{d.totalPct != null ? ` (${signedPct(d.totalPct)})` : ''}</span>
        )}
        {d.market != null && (
          <span>dont marché <strong className={toneOf(d.market)}>{fmtSignedEur(d.market)}</strong> <span className="muted">à quantités constantes</span></span>
        )}
        {d.cashDelta != null && Math.abs(d.cashDelta) >= 0.01 && (
          <span>Liquidités <strong>{fmtSignedEur(d.cashDelta)}</strong></span>
        )}
      </div>
      {chips.length > 0 && (
        <div className="chip-row" style={{ marginTop: 12 }}>
          {chips.map((c) => (c.isins
            ? <button key={c.label} type="button" className="chip filter" onClick={() => onFocus({ title: c.title || c.label, isins: c.isins })}>{c.label}</button>
            : <span key={c.label} className="chip" title={c.names?.join(', ')}>{c.label}</span>))}
        </div>
      )}
      {movers.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <DivergingBars rows={movers} onPick={(r) => onPick(r.key)} />
        </div>
      )}
      <p className="ana-note">
        L'écart entre la valeur totale et l'effet marché vient de tes achats et ventes, des versements, dividendes et frais.
      </p>
    </Card>
  );
}

/**
 * Évolution du patrimoine : valeur totale et versements nets dans le temps, et
 * ce qui revient au marché une fois les versements retirés.
 */
function Evolution({ history }) {
  const [range, setRange] = usePersistentState('degiro_evo_range', '1y');
  const ev = evolution(history, range);
  const all = evolution(history, 'all');
  if (!all) return null;
  return (
    <Card className="ana-block" title="Évolution du patrimoine">
      <div className="evo-head">
        <div className="since-figs">
          {ev ? (
            <>
              <span>Depuis le {fmtDate(ev.from)} <strong className={toneOf(ev.change)}>{fmtSignedEur(ev.change)}</strong>{ev.changePct != null ? ` (${signedPct(ev.changePct)})` : ''}</span>
              {ev.deposits != null && (
                <span>dont versements <strong>{fmtSignedEur(ev.deposits)}</strong></span>
              )}
              {ev.market != null && (
                <span>dont marché <strong className={toneOf(ev.market)}>{fmtSignedEur(ev.market)}</strong>{ev.marketPct != null ? ` (${signedPct(ev.marketPct)})` : ''}</span>
              )}
            </>
          ) : <span className="muted">Pas assez de captures sur cette période.</span>}
        </div>
        <span className="evo-ranges" role="group" aria-label="Période">
          {RANGES.map((r) => (
            <button key={r.key} type="button" className={`chip filter${range === r.key ? ' on' : ''}`} aria-pressed={range === r.key} onClick={() => setRange(r.key)}>{r.label}</button>
          ))}
        </span>
      </div>
      {ev && (
        <TimeChart
          label={`Valeur totale du ${fmtDate(ev.from)} au ${fmtDate(ev.to)}`}
          series={[
            { key: 'total', label: 'Valeur totale', color: 'var(--c1)', points: ev.points.map((p) => [p.date, p.total]) },
            { key: 'dep', label: 'Versements nets', color: 'var(--c7)', step: true, dashed: true, points: ev.points.filter((p) => p.deposits != null).map((p) => [p.date, p.deposits]) },
          ]}
        />
      )}
      <p className="ana-note">
        {ev?.market != null
          ? `Marché = variation de la valeur moins tes versements${ev.depositsFrom && ev.depositsFrom > ev.from ? ` (calculé depuis le ${fmtDate(ev.depositsFrom)}, première capture avec les versements)` : ''} : ce que ton argent a rapporté ou perdu, dividendes et frais compris.`
          : all.hasDeposits
            ? 'Les versements nets ne sont connus que sur une partie de la période : élargis-la, ou attends quelques captures.'
            : 'Les versements nets arrivent avec les captures de l’extension : ils permettront de séparer ce que tu as versé de ce que le marché a rapporté.'}
      </p>
    </Card>
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
  const prices = usePrices();
  const [history, setHistory] = useState(null);

  useEffect(() => {
    getPortfolio().then(setData).catch((e) => setError(e.message));
    getLookthrough().then(setLookthrough).catch(() => setLookthrough(null));
    getHistory().then((r) => setHistory(r.points || [])).catch(() => setHistory([]));
  }, []);

  const a = useMemo(() => (data?.snapshot ? analyzePortfolio(data) : null), [data]);
  const since = useMemo(() => (data?.snapshot ? diffSnapshots(data, data.previous) : null), [data]);
  // Après l'enregistrement d'une note, le tiroir doit montrer la ligne rechargée.
  useEffect(() => {
    if (a) setSelected((cur) => (cur ? a.lines.find((l) => l.isin === cur.isin) || null : cur));
  }, [a]);
  const reload = () => getPortfolio().then(setData).catch(() => {});
  const points = useMemo(() => {
    if (!a) return [];
    const lt = hasLookthrough(lookthrough) ? lookthrough : null;
    return attentionPoints(a, { lookthrough: lt, sectors: breakdown(a.lines, 'sector', lt) });
  }, [a, lookthrough]);

  // Écart au plus haut 12 mois, en euros : pour repérer d'un coup d'œil les
  // lignes en forte baisse (détail dans le panneau de la ligne).
  const lines = useMemo(() => (a?.lines || []).map((l) => {
    const h = prices ? historyStats(prices.byIsin.get(l.isin), prices.fx, l) : null;
    return { ...l, fromHigh12: h?.unit === 'EUR' ? h.windows.m12?.fromHigh ?? null : null };
  }), [a, prices]);
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
  // Âge de la capture : la « variation du jour » d'une capture de vendredi, lue
  // lundi, est celle de vendredi — l'étiquette doit le dire.
  const age = daysBetween(a.snapshot.snapshot_date, parisToday());

  return (
    <>
      {age != null && age >= 3 && (
        <div className="ana-block">
          <Banner kind={age >= 7 ? 'warn' : 'info'}>
            <strong>Dernière {a.snapshot.source === 'extension' ? 'capture' : 'importation'} il y a {plural(age, 'jour')}</strong>
            {' '}({fmtDate(a.snapshot.snapshot_date)}) : tes chiffres datent.{' '}
            {a.snapshot.source === 'extension'
              ? 'Ouvre DEGIRO et lance une capture depuis l’extension.'
              : 'Exporte un Portfolio.csv récent, ou utilise l’extension.'}
            {' '}<button type="button" className="link-btn" onClick={onGoImport}>Import / Extension →</button>
          </Banner>
        </div>
      )}
      <div className="kpi-strip ana-kpis">
        <Kpi label="Valeur totale" value={fmtEur(a.total)} sub={`au ${fmtDate(a.snapshot.snapshot_date)} · ${source}`} />
        {a.sinceStart && (
          <Kpi
            label="Résultat depuis l'ouverture"
            value={fmtSignedEur(a.sinceStart.gain)}
            sub={`${a.sinceStart.pct != null ? `${signedPct(a.sinceStart.pct)} de ` : ''}${fmtEur(a.sinceStart.deposits)} versés nets`}
            tone={toneOf(a.sinceStart.gain)}
          />
        )}
        <Kpi label="Titres" value={fmtEur(a.invested)} sub={a.pl ? `coût ${fmtEur(a.pl.cost)}${a.pl.coverage < 0.999 ? ' (lignes connues)' : ''}` : plural(c.n, 'ligne')} />
        <Kpi
          label="+/- value latente"
          value={a.pl ? fmtSignedEur(a.pl.total) : '—'}
          sub={a.pl
            ? `${signedPct(a.pl.pct)} du coût${a.realized?.count ? ` · ${fmtSignedEur(a.realized.total)} déjà réalisés à part` : ''}`
            : 'non fournie par Portfolio.csv'}
          tone={a.pl ? toneOf(a.pl.total) : ''}
        />
        <Kpi
          label={age != null && age >= 1 ? `Variation du ${fmtDateShort(a.snapshot.snapshot_date)}` : 'Variation du jour'}
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

      {since && <SinceLast d={since} onFocus={focusOn} onPick={pick} />}

      {history && <Evolution history={history} />}

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
                <SortHeader label="Coût moy." colKey="avgCost" sort={sort} onToggle={toggle} cls="col-opt" />
                <SortHeader label="Valeur" colKey="value" sort={sort} onToggle={toggle} />
                <SortHeader label="Poids" colKey="w" sort={sort} onToggle={toggle} />
                <SortHeader label="+/- €" colKey="pl" sort={sort} onToggle={toggle} />
                <SortHeader label="+/- %" colKey="plPct" sort={sort} onToggle={toggle} />
                <SortHeader label="Jour" colKey="dayPct" sort={sort} onToggle={toggle} cls="col-opt" />
                <SortHeader label="vs + haut 12 m" colKey="fromHigh12" sort={sort} onToggle={toggle} cls="col-opt" />
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key ?? 'all'}>
                {g.key != null && (
                  <tr className="group-row">
                    <th colSpan={4} scope="rowgroup">{g.key} <span className="muted">· {plural(g.lines.length, 'ligne')}</span></th>
                    <td>{fmtEur(g.value)}</td>
                    <td>{fmtPct(a.invested > 0 ? g.value / a.invested : 0)}</td>
                    <td colSpan={4} />
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
                    <td className="col-opt">{l.avgCost != null ? fmtEur(l.avgCost) : <span className="muted">—</span>}</td>
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
                    <td className={`col-opt ${l.fromHigh12 == null ? 'muted' : ''}`} title="Écart du cours (en €) à son plus haut des 12 derniers mois">
                      {l.fromHigh12 == null ? '—' : signedPct(l.fromHigh12)}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
            {sorted.length === 0 && (
              <tbody>
                <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 18 }}>Aucune position ne correspond aux filtres.</td></tr>
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
        onNoteSaved={reload}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
