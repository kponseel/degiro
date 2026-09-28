import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { getPortfolio, getLookthrough } from '../lib/api.js';
import { fmtEur, fmtPct, fmtNum, fmtDate, fmtSignedEur, toneOf } from '../lib/format.js';
import { Spinner, Card, Banner, Empty } from '../components/ui.jsx';
import FilterBar from '../components/FilterBar.jsx';
import PositionDrawer from '../components/PositionDrawer.jsx';
import { usePersistentState, distinctValues, applyFilters } from '../lib/useFilters.js';
import { useSort } from '../lib/useSort.js';
import SortHeader from '../components/SortHeader.jsx';

const EMPTY_FILTER = { q: '', type: '', sector: '', country: '' };
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
const TT = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)', fontSize: 13 };

/** Bandeau de chiffres clés : dense, une seule ligne sur desktop. */
function Kpi({ label, value, sub, tone }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${tone || ''}`}>{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

/**
 * Une ligne de « meilleures / moins bonnes ».
 *
 * Les deux colonnes étaient écrites en double, et avaient divergé : la colonne des
 * pertes affichait le montant sans signe et calculait son ton à part, si bien qu'un
 * gain y apparaissait « 12,00 € » quand la colonne d'en face affichait « +12,00 € ».
 *
 * Le libellé est tronqué quand la place manque — c'est voulu, la carte est étroite —
 * mais il l'était sans recours : un titre sans symbole n'affichait qu'un début de
 * nom coupé. `title` rend le nom complet au survol, et le donne au lecteur d'écran.
 */
function Mover({ p, onSelect }) {
  const nom = p.name || p.symbol || p.isin;
  return (
    <button className="mover" onClick={() => onSelect(p)} title={nom}>
      <span className="mover-sym">{p.symbol || p.name}</span>
      <span className={`mover-val ${toneOf(p.pl_eur)}`}>{fmtSignedEur(p.pl_eur)}</span>
    </button>
  );
}

export default function Overview({ onGoImport }) {
  const [data, setData] = useState(null);
  const [lookthrough, setLookthrough] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = usePersistentState('degiro_filter_overview', EMPTY_FILTER);

  useEffect(() => {
    getPortfolio().then(setData).catch((e) => setError(e.message));
    getLookthrough().then(setLookthrough).catch(() => setLookthrough(null));
  }, []);

  // Ouvre le générateur de prompts pré-rempli pour un titre (raccourci contextuel).
  const analyze = (p) => { window.location.hash = `#/ai?isin=${encodeURIComponent(p.isin)}`; };

  const positions = data?.positions || [];
  const totalPos = positions.reduce((s, p) => s + (Number(p.value_eur) || 0), 0);
  const weighted = positions.map((p) => ({ ...p, w: totalPos ? (Number(p.value_eur) || 0) / totalPos : 0 }));

  const typeOf = (p) => p.asset_class || p.product_type || '';
  const filtered = applyFilters(weighted, filter, {
    searchFields: ['name', 'symbol', 'ticker', 'isin'],
    facetGetters: { type: typeOf, sector: (p) => p.sector || '', country: (p) => p.country || '' },
  });
  const { sorted, sort, toggle } = useSort(filtered, { key: 'value_eur', dir: 'desc' }, {
    name: (p) => p.name || p.isin,
    type: typeOf,
  });

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!data) return <Spinner />;

  if (!data.snapshot) {
    return (
      <Card>
        <Empty title="Aucune donnée pour l'instant">
          Importe un export DEGIRO (Portfolio.csv) pour voir ton portefeuille.
          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={onGoImport}>Importer mon portefeuille</button>
          </div>
        </Empty>
      </Card>
    );
  }

  const { snapshot } = data;
  const totalValue = Number(snapshot.total_value_eur) || totalPos;
  const totalPl = positions.reduce((s, p) => s + (Number(p.pl_eur) || 0), 0);
  const hasPl = positions.some((p) => p.pl_eur != null);

  // Répartition par classe d'actifs (compacte, à côté de la courbe).
  const byClass = [...weighted.reduce((m, p) => {
    const k = typeOf(p) || 'Non typé';
    m.set(k, (m.get(k) || 0) + (Number(p.value_eur) || 0));
    return m;
  }, new Map())].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);

  const movers = [...weighted].filter((p) => p.pl_eur != null).sort((a, b) => Number(b.pl_eur) - Number(a.pl_eur));
  const best = movers.slice(0, 3);
  // Découpage sans recouvrement : avec moins de 6 lignes, `slice(-3)` reprenait
  // des titres déjà cités dans « meilleures », qui apparaissaient donc des deux
  // côtés à la fois.
  const worst = movers.slice(Math.max(3, movers.length - 3)).reverse();

  const facets = [
    { key: 'type', label: 'Type', value: filter.type, options: distinctValues(weighted, typeOf), onChange: (v) => setFilter((f) => ({ ...f, type: v })) },
    { key: 'sector', label: 'Secteur', value: filter.sector, options: distinctValues(weighted, (p) => p.sector), onChange: (v) => setFilter((f) => ({ ...f, sector: v })) },
    { key: 'country', label: 'Pays', value: filter.country, options: distinctValues(weighted, (p) => p.country), onChange: (v) => setFilter((f) => ({ ...f, country: v })) },
  ];

  return (
    <>
      <div className="kpi-strip">
        <Kpi
          label="Valeur totale"
          value={fmtEur(totalValue)}
          sub={`au ${fmtDate(snapshot.snapshot_date)}`}
        />
        <Kpi
          label="P/L latent"
          value={hasPl ? fmtSignedEur(totalPl) : '—'}
          sub={hasPl && totalValue ? fmtPct(totalPl / (totalValue - totalPl)) : 'non fourni'}
          tone={hasPl ? toneOf(totalPl) : ''}
        />
        <Kpi label="Liquidités" value={fmtEur(snapshot.cash_eur)} />
        <Kpi label="Lignes" value={fmtNum(positions.length, 0)} sub="positions détenues" />
      </div>

      <div style={{ marginBottom: 14 }}>
        <Card title="Répartition" className="dash-alloc">
          <div className="alloc-wrap">
            <div className="alloc-chart">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byClass} dataKey="value" nameKey="key" innerRadius={38} outerRadius={58} paddingAngle={2}
                    stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
                    {byClass.map((d, i) => <Cell key={d.key} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [fmtEur(v), n]} contentStyle={TT} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="alloc-legend">
              {byClass.map((d, i) => (
                <button key={d.key} className="alloc-item" onClick={() => setFilter((f) => ({ ...f, type: f.type === d.key ? '' : d.key }))}>
                  <span className="legend-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="alloc-name">{d.key}</span>
                  <span className="alloc-val">{fmtPct(d.value / totalPos)}</span>
                </button>
              ))}
            </div>
          </div>

          {best.length > 0 && (
            <div className="movers">
              <div className="movers-col">
                <span className="movers-title">Meilleures lignes</span>
                {best.map((p) => <Mover key={p.isin} p={p} onSelect={setSelected} />)}
              </div>
              <div className="movers-col">
                <span className="movers-title">Moins bonnes</span>
                {worst.map((p) => <Mover key={p.isin} p={p} onSelect={setSelected} />)}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Positions">
        <FilterBar
          q={filter.q}
          onQ={(v) => setFilter((f) => ({ ...f, q: v }))}
          facets={facets}
          onReset={() => setFilter(EMPTY_FILTER)}
          count={sorted.length}
          total={weighted.length}
          placeholder="Titre, ticker, ISIN…"
        />
        <div className="table-wrap">
          <table className="data compact">
            <thead>
              <tr>
                <SortHeader label="Titre" colKey="name" sort={sort} onToggle={toggle} align="left" />
                <SortHeader label="Type" colKey="type" sort={sort} onToggle={toggle} align="left" cls="col-opt" />
                <SortHeader label="Qté" colKey="qty" sort={sort} onToggle={toggle} cls="col-opt" />
                <SortHeader label="Cours" colKey="price" sort={sort} onToggle={toggle} cls="col-opt" />
                <SortHeader label="Valeur" colKey="value_eur" sort={sort} onToggle={toggle} />
                <SortHeader label="Poids" colKey="w" sort={sort} onToggle={toggle} cls="col-opt" />
                <SortHeader label="P/L" colKey="pl_eur" sort={sort} onToggle={toggle} />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 18 }}>Aucune position ne correspond aux filtres.</td></tr>
              )}
              {sorted.map((p) => {
                const ac = typeOf(p);
                const isFund = ac === 'ETF' || ac === 'ETC';
                return (
                  <tr key={p.isin} className="row-click" onClick={() => setSelected(p)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(p); } }}>
                    <td>
                      {/* Un Portfolio.csv ne porte pas de ticker : le nom devient alors le
                          libellé principal, plutôt qu'un « — » suivi d'un nom grisé. */}
                      {p.symbol || p.ticker ? (
                        <><span className="sym">{p.symbol || p.ticker}</span>{' '}<span className="muted">{p.name || p.isin}</span></>
                      ) : (
                        <span className="sym">{p.name || p.isin}</span>
                      )}
                    </td>
                    <td className="col-opt">{ac ? <span className={`chip ${isFund ? 'etf' : 'stock'}`}>{ac}</span> : <span className="muted">—</span>}</td>
                    <td className="col-opt">{fmtNum(p.qty, 0)}</td>
                    <td className="col-opt">{fmtNum(p.price)} <span className="muted sm">{p.currency}</span></td>
                    <td className="sym">{fmtEur(p.value_eur)}</td>
                    <td className="col-opt">{fmtPct(p.w)}</td>
                    <td className={p.pl_eur == null ? 'muted' : toneOf(p.pl_eur)}>{fmtSignedEur(p.pl_eur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="sub muted" style={{ marginTop: 10, fontSize: 12.5 }}>
          Clique une ligne pour le détail (exposition réelle, liens finance, prompt IA).
        </div>
      </Card>

      <PositionDrawer
        position={selected}
        lookthrough={lookthrough}
        onAnalyze={analyze}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
