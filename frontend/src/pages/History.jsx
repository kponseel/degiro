import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getSnapshots } from '../lib/api.js';
import { fmtEur, fmtPct, fmtDate } from '../lib/format.js';
import { Spinner, Card, Stat, Banner, Empty } from '../components/ui.jsx';

export default function History() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getSnapshots().then((d) => setRows(d.snapshots)).catch((e) => setError(e.message));
  }, []);

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
  const changePct = first ? change / first : 0;

  return (
    <>
      <div className="grid stat-row">
        <Stat label="Valeur actuelle" value={fmtEur(last)} sub={`au ${data[data.length - 1].date}`} />
        <Stat label="Depuis le début" value={fmtEur(change)} sub={fmtPct(changePct)} tone={change >= 0 ? 'pos' : 'neg'} />
        <Stat label="Points" value={data.length} sub={`du ${data[0].date}`} />
      </div>
      <Card title="Valeur totale du portefeuille">
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--line-soft)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--ink-faint)' }} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={24} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--ink-faint)' }} tickLine={false} axisLine={false} width={70}
                tickFormatter={(v) => new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v)} />
              <Tooltip
                formatter={(v) => [fmtEur(v), 'Valeur']}
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' }}
                labelStyle={{ color: 'var(--ink-soft)' }}
              />
              <Area type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} fill="url(#g)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}
