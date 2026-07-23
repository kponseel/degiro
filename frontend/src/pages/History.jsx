import { useEffect, useState } from 'react';
import { AreaChart, Area, LineChart, Line, Legend, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getSnapshots, getPerformance, getBenchmark } from '../lib/api.js';
import { fmtEur, fmtPct, fmtDate } from '../lib/format.js';
import { Spinner, Card, Stat, Banner, Empty } from '../components/ui.jsx';

const TT = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' };
const axisTick = { fontSize: 12, fill: 'var(--ink-faint)' };

export default function History() {
  const [rows, setRows] = useState(null);
  const [perf, setPerf] = useState(null);
  const [benchKey, setBenchKey] = useState('world');
  const [bench, setBench] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getSnapshots().then((d) => setRows(d.snapshots)).catch((e) => setError(e.message));
    getPerformance().then(setPerf).catch(() => setPerf({ insufficient: true }));
  }, []);

  useEffect(() => {
    setBench(null);
    getBenchmark(benchKey).then(setBench).catch(() => setBench({ available: false, reason: 'error' }));
  }, [benchKey]);

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!rows) return <Spinner />;

  if (rows.length < 2) {
    return (
      <Card>
        <Empty title="Pas encore assez d'historique">
          L'historique se construit à chaque capture. Il faut au moins deux jours de données pour tracer une courbe.
          {rows.length === 1 && <div style={{ marginTop: 8 }}>1 point enregistré pour l'instant.</div>}
        </Empty>
      </Card>
    );
  }

  const data = rows.map((r) => ({ date: fmtDate(r.snapshot_date), value: Number(r.total_value_eur) || 0 }));
  const first = data[0].value;
  const last = data[data.length - 1].value;
  const change = last - first;
  const twr = perf && !perf.insufficient ? perf.twr : null;

  const benchAvailable = bench && bench.available;
  const benchName = bench?.name || 'Benchmark';
  const alpha = benchAvailable ? bench.alpha : null;
  // Série combinée portefeuille vs benchmark (en %), issue de l'endpoint aligné.
  const compareSeries = benchAvailable
    ? bench.series.map((s) => ({ date: fmtDate(s.date), twr: s.twr * 100, benchmark: s.benchmark != null ? s.benchmark * 100 : null }))
    : (perf && perf.series ? perf.series.map((s) => ({ date: fmtDate(s.date), twr: s.twr * 100, benchmark: null })) : []);

  return (
    <>
      <div className="grid stat-row">
        <Stat label="Valeur actuelle" value={fmtEur(last)} sub={`au ${data[data.length - 1].date}`} />
        <Stat
          label="Performance (TWR)"
          value={twr != null ? fmtPct(twr) : '—'}
          sub={twr != null ? `du ${fmtDate(perf.from)} au ${fmtDate(perf.to)}` : '≥ 2 jours requis'}
          tone={twr != null ? (twr >= 0 ? 'pos' : 'neg') : ''}
        />
        {benchAvailable && alpha != null ? (
          <Stat
            label={`Surperformance / ${benchName}`}
            value={`${alpha >= 0 ? '+' : ''}${fmtPct(alpha)}`}
            sub={`benchmark : ${fmtPct(bench.benchmarkReturn)}`}
            tone={alpha >= 0 ? 'pos' : 'neg'}
          />
        ) : (
          <Stat label="Variation de valeur" value={fmtEur(change)} sub="apports inclus" tone={change >= 0 ? 'pos' : 'neg'} />
        )}
        <Stat label="Points" value={data.length} sub={`depuis le ${data[0].date}`} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Banner kind="info">
          Le <strong>TWR</strong> (Time-Weighted Return) mesure ta performance réelle en neutralisant tes dépôts/retraits.
          Pour qu'il soit exact, importe ton <strong>Account.csv</strong> (les flux).{' '}
          {perf && perf.flows ? `${perf.flows} flux externe(s) pris en compte.` : 'Aucun flux externe détecté — le TWR égale la variation de valeur.'}
        </Banner>
      </div>

      <Card title="Valeur totale du portefeuille">
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--line-soft)" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={24} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={70}
                tickFormatter={(v) => new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v)} />
              <Tooltip formatter={(v) => [fmtEur(v), 'Valeur']} contentStyle={TT} labelStyle={{ color: 'var(--ink-soft)' }} />
              <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="url(#gv)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {compareSeries.length >= 2 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Performance cumulée — portefeuille vs benchmark">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              {(bench?.benchmarks || [{ key: 'world', name: 'MSCI World' }]).map((b) => (
                <button
                  key={b.key}
                  className={`btn ${benchKey === b.key ? '' : 'ghost'}`}
                  style={{ padding: '5px 12px', fontSize: 13 }}
                  onClick={() => setBenchKey(b.key)}
                >
                  {b.name}
                </button>
              ))}
            </div>

            {bench && !bench.available && (
              <div style={{ marginBottom: 14 }}>
                <Banner kind="info">
                  {bench.reason === 'insufficient_history'
                    ? 'Le benchmark s’affichera dès que tu auras au moins deux jours d’historique.'
                    : 'Cours du benchmark momentanément indisponibles (source publique injoignable). La courbe du portefeuille reste affichée ; réessaie plus tard.'}
                </Banner>
              </div>
            )}

            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={compareSeries} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={24} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `${v.toFixed(0)} %`} />
                  <Tooltip
                    formatter={(v, n) => [v == null ? '—' : `${Number(v).toFixed(2)} %`, n]}
                    contentStyle={TT}
                    labelStyle={{ color: 'var(--ink-soft)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Line type="monotone" dataKey="twr" name="Portefeuille (TWR)" stroke="var(--c1)" strokeWidth={2.4} dot={false} isAnimationActive={false} />
                  {benchAvailable && (
                    <Line type="monotone" dataKey="benchmark" name={benchName} stroke="var(--c2)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="sub muted" style={{ marginTop: 12, fontSize: 12.5 }}>
              Comparaison équitable : le TWR neutralise tes apports, le benchmark est un investissement « buy &amp; hold »
              sur la même période. Source des cours : Stooq (données de clôture, à titre indicatif).
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
