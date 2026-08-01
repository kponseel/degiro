import { useEffect, useState } from 'react';
import { LineChart, Line, Legend, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getSnapshots, getPerformance, getBenchmark, getAnalytics } from '../lib/api.js';
import { fmtEur, fmtPct, fmtDate, fmtDateShort, fmtNum, plural } from '../lib/format.js';
import { Spinner, Card, Stat, Banner, Empty } from '../components/ui.jsx';
import { useSort } from '../lib/useSort.js';
import SortHeader from '../components/SortHeader.jsx';
import RealizedPanel from '../components/RealizedPanel.jsx';
import PerfCharts from '../components/PerfCharts.jsx';
import Dividends from './Dividends.jsx';

const TT = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' };
const axisTick = { fontSize: 12, fill: 'var(--ink-faint)' };
const signPct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmtPct(v)}`);
const signEur = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmtEur(v)}`);
const tone = (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');

/** Barre de contribution : part (signée) d'une ligne dans le P/L total. */
function ContribBar({ value }) {
  if (value == null) return <span className="muted">—</span>;
  const pct = Math.max(-1, Math.min(1, value));
  const width = `${Math.min(100, Math.abs(pct) * 100)}%`;
  return (
    <div className="contrib" title={signPct(value)}>
      <div className="contrib-track">
        <span className={`contrib-fill ${pct >= 0 ? 'pos' : 'neg'}`} style={{ width }} />
      </div>
      <span className="contrib-val">{signPct(value)}</span>
    </div>
  );
}

// ── Détail par titre ─────────────────────────────────────────────────
function AttributionTable({ rows, hasDividends }) {
  const { sorted, sort, toggle } = useSort(rows, { key: 'pl_eur', dir: 'desc' }, {
    name: (r) => r.name || r.isin,
  });
  return (
    <div className="table-wrap">
      <table className="data compact">
        <thead>
          <tr>
            <SortHeader label="Titre" colKey="name" sort={sort} onToggle={toggle} align="left" />
            <SortHeader label="Poids" colKey="weight" sort={sort} onToggle={toggle} />
            <SortHeader label="Valeur" colKey="value_eur" sort={sort} onToggle={toggle} />
            <SortHeader label="+/- €" colKey="pl_eur" sort={sort} onToggle={toggle} />
            <SortHeader label="+/- %" colKey="pl_pct" sort={sort} onToggle={toggle} />
            <SortHeader label="Contribution" colKey="contribution" sort={sort} onToggle={toggle} />
            {hasDividends && <SortHeader label="Dividendes" colKey="dividends_eur" sort={sort} onToggle={toggle} />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.isin}>
              <td>
                <span className="sym">{r.name}</span>
                {r.sector && <span className="muted sm"> · {r.sector}</span>}
              </td>
              <td>{fmtPct(r.weight)}</td>
              <td className="sym">{fmtEur(r.value_eur)}</td>
              <td className={tone(r.pl_eur)}>{signEur(r.pl_eur)}</td>
              <td className={tone(r.pl_pct)}>{signPct(r.pl_pct)}</td>
              <td><ContribBar value={r.contribution} /></td>
              {hasDividends && <td className={r.dividends_eur ? 'pos' : 'muted'}>{r.dividends_eur ? fmtEur(r.dividends_eur) : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function History({ onGoImport }) {
  const [rows, setRows] = useState(null);
  const [perf, setPerf] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [benchKey, setBenchKey] = useState('world');
  const [bench, setBench] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getSnapshots().then((d) => setRows(d.snapshots)).catch((e) => setError(e.message));
    getPerformance().then(setPerf).catch(() => setPerf({ insufficient: true }));
    getAnalytics().then(setAnalytics).catch(() => setAnalytics(null));
  }, []);

  useEffect(() => {
    setBench(null);
    getBenchmark(benchKey).then(setBench).catch(() => setBench({ available: false, reason: 'error' }));
  }, [benchKey]);

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!rows) return <Spinner />;

  if (rows.length === 0) {
    return (
      <Card>
        <Empty title="Aucune donnée de performance">
          Importe ton portefeuille pour analyser ta performance.
          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={onGoImport}>Importer mon portefeuille</button>
          </div>
        </Empty>
      </Card>
    );
  }

  const data = rows.map((r) => ({ date: fmtDateShort(r.snapshot_date), value: Number(r.total_value_eur) || 0 }));
  const last = data[data.length - 1].value;
  const first = data[0].value;
  const change = last - first;
  const twr = perf && !perf.insufficient ? perf.twr : null;
  const risk = analytics?.risk || null;
  const conc = analytics?.concentration || null;
  const attr = analytics?.attribution || null;

  const benchAvailable = bench && bench.available;
  const benchName = bench?.name || 'Benchmark';
  const alpha = benchAvailable ? bench.alpha : null;
  const compareSeries = benchAvailable
    ? bench.series.map((s) => ({ date: fmtDateShort(s.date), twr: s.twr * 100, benchmark: s.benchmark != null ? s.benchmark * 100 : null }))
    : (perf && perf.series ? perf.series.map((s) => ({ date: fmtDateShort(s.date), twr: s.twr * 100, benchmark: null })) : []);

  const totalPl = attr?.totals?.pl_eur ?? null;
  const totalPlPct = attr?.totals?.pl_pct ?? null;
  const realized = analytics?.realized || null;
  const capital = perf?.capital || null;

  return (
    <>
      <div className="page-head">
        <h1>Performance</h1>
        <p>Ta performance réelle, sa décomposition par titre, et les mesures de risque de ton portefeuille.</p>
      </div>

      {/* KPIs principaux.
          Le capital investi et le bénéfice passent devant : ce sont les deux
          chiffres qui répondent à « est-ce que je gagne de l'argent ? ». La
          valeur seule ne le dit pas — elle monte aussi quand on verse. */}
      <div className="grid stat-row">
        <Stat label="Valeur actuelle" value={fmtEur(last)} sub={`au ${data[data.length - 1].date}`} />
        {capital && capital.invested != null && capital.coverage !== 'none' ? (
          <>
            <Stat label="Capital investi" value={fmtEur(capital.invested)} sub={`${plural(capital.flows, 'versement')} depuis le ${fmtDate(capital.firstFlow)}`} />
            <Stat
              label="Bénéfice"
              value={signEur(capital.pnl)}
              sub={capital.pnlPct != null ? `${signPct(capital.pnlPct)} du capital` : 'valeur − capital investi'}
              tone={tone(capital.pnl)}
            />
          </>
        ) : (
          <Stat label="+/- value latente" value={signEur(totalPl)} sub={totalPlPct != null ? signPct(totalPlPct) : 'apports inclus'} tone={tone(totalPl)} />
        )}
        <Stat
          label="Performance (TWR)"
          value={twr != null ? signPct(twr) : '—'}
          sub={twr != null ? `du ${fmtDate(perf.from)} au ${fmtDate(perf.to)}` : '≥ 2 jours requis'}
          tone={tone(twr)}
        />
        {benchAvailable && alpha != null ? (
          <Stat label={`vs ${benchName}`} value={signPct(alpha)} sub={`indice : ${signPct(bench.benchmarkReturn)}`} tone={tone(alpha)} />
        ) : (
          <Stat label="Variation de valeur" value={signEur(change)} sub="apports inclus" tone={tone(change)} />
        )}
      </div>

      {/* Graphiques d'évolution : valeur vs capital, bénéfice, rendement
          mensuel, drawdown, composition. */}
      <div style={{ marginTop: 16 }}>
        <PerfCharts snapshots={rows} perf={perf} />
      </div>

      {/* Gains / pertes réalisés + vue fiscale */}
      {realized && (
        <div style={{ marginTop: 16 }}>
          <RealizedPanel realized={realized} latentPl={totalPl} />
        </div>
      )}

      {/* Mesures de risque */}
      {risk ? (
        <div style={{ marginTop: 16 }}>
          <Card title="Risque & volatilité">
            <div className="grid stat-row">
              <Stat label="Volatilité (ann.)" value={fmtPct(risk.volatility)} sub="amplitude des variations" />
              <Stat label="Pire baisse (drawdown)" value={fmtPct(risk.maxDrawdown)} sub="du sommet au creux" tone="neg" />
              <Stat label="Sharpe" value={risk.sharpe != null ? fmtNum(risk.sharpe, 2) : '—'} sub="rendement / risque" tone={risk.sharpe > 0 ? 'pos' : ''} />
              <Stat label="Meilleur / pire jour" value={`${signPct(risk.bestPeriod)} / ${signPct(risk.worstPeriod)}`} sub={`${risk.periods} périodes`} />
            </div>
            {risk.currentDrawdown < -0.001 && (
              <div style={{ marginTop: 12 }}>
                <Banner kind="info">
                  Actuellement à <strong>{fmtPct(risk.currentDrawdown)}</strong> sous ton plus haut historique.
                </Banner>
              </div>
            )}
          </Card>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <Banner kind="info">
            Les mesures de risque (volatilité, drawdown, Sharpe) apparaîtront avec au moins quelques jours d'historique.
            L'historique se construit à chaque capture.
          </Banner>
        </div>
      )}

      {/* Concentration */}
      {conc && conc.lines > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Concentration & diversification">
            <div className="grid stat-row">
              <Stat label="Plus grosse ligne" value={fmtPct(conc.top1)} sub="poids du n°1" tone={conc.top1 > 0.25 ? 'neg' : ''} />
              <Stat label="Top 5" value={fmtPct(conc.top5)} sub={`sur ${conc.lines} lignes`} tone={conc.top5 > 0.6 ? 'neg' : ''} />
              <Stat label="Lignes effectives" value={fmtNum(conc.effectiveHoldings, 1)} sub="diversification réelle" />
              <Stat label="Lignes détenues" value={fmtNum(conc.lines, 0)} />
            </div>
            {conc.effectiveHoldings < conc.lines / 2 && (
              <div style={{ marginTop: 12 }}>
                <Banner kind="info">
                  Tu détiens {conc.lines} lignes mais l'équivalent de seulement <strong>{fmtNum(conc.effectiveHoldings, 1)}</strong> en
                  diversification réelle : quelques positions pèsent lourd.
                </Banner>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Détail par titre */}
      {attr && attr.rows.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Performance par titre">
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              La <strong>contribution</strong> est la part de chaque ligne dans ta +/- value totale.
              Clique les en-têtes pour trier.
            </p>
            <AttributionTable rows={attr.rows} hasDividends={(attr.totals.dividends_eur || 0) !== 0} />
          </Card>
        </div>
      )}

      <div style={{ margin: '16px 0' }}>
        <Banner kind="info">
          Le <strong>TWR</strong> mesure ta performance réelle en neutralisant tes dépôts/retraits.
          Pour qu'il soit exact, importe ton <strong>Account.csv</strong>.{' '}
          {perf && perf.flows ? `${plural(perf.flows, 'flux externe', 'flux externes')} pris en compte.` : 'Aucun flux externe détecté — le TWR égale la variation de valeur.'}
        </Banner>
      </div>

      {compareSeries.length >= 2 && (
        <Card title="Performance cumulée — portefeuille vs indice">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {(bench?.benchmarks || [{ key: 'world', name: 'MSCI World' }]).map((b) => (
              <button key={b.key} className={`btn ${benchKey === b.key ? '' : 'ghost'}`} style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => setBenchKey(b.key)}>
                {b.name}
              </button>
            ))}
          </div>

          {bench && !bench.available && (
            <div style={{ marginBottom: 14 }}>
              <Banner kind="info">
                {bench.reason === 'insufficient_history'
                  ? 'Le comparatif s’affichera dès deux jours d’historique.'
                  : 'Cours de l’indice momentanément indisponibles (source publique injoignable). La courbe du portefeuille reste affichée.'}
              </Banner>
            </div>
          )}

          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={compareSeries} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={24} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `${v.toFixed(0)} %`} />
                <Tooltip formatter={(v, n) => [v == null ? '—' : `${Number(v).toFixed(2)} %`, n]} contentStyle={TT} labelStyle={{ color: 'var(--ink-soft)' }} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Line type="monotone" dataKey="twr" name="Portefeuille (TWR)" stroke="var(--c1)" strokeWidth={2.4} dot={false} isAnimationActive={false} />
                {benchAvailable && (
                  <Line type="monotone" dataKey="benchmark" name={benchName} stroke="var(--c2)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="sub muted" style={{ marginTop: 12, fontSize: 12.5 }}>
            Comparaison équitable : le TWR neutralise tes apports, l'indice est un « buy &amp; hold » sur la même période.
            Cours : Stooq (clôtures, à titre indicatif).
          </div>
        </Card>
      )}

      {/* Les dividendes vivent ici, en bas de la page Performance : ils font
          partie du rendement, mais ne méritaient pas un onglet à eux seuls. */}
      <div className="card-title" style={{ margin: '22px 2px 12px' }}>Dividendes</div>
      <Dividends onGoImport={onGoImport} />
    </>
  );
}
