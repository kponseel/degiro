import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { getPortfolio, getExposure } from '../lib/api.js';
import { fmtEur, fmtPct } from '../lib/format.js';
import { Spinner, Card, Banner, Empty } from '../components/ui.jsx';

const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];

function groupBy(positions, keyFn, fallback = 'Inconnu') {
  const map = new Map();
  let total = 0;
  for (const p of positions) {
    const v = Number(p.value_eur) || 0;
    total += v;
    const k = keyFn(p) || fallback;
    map.set(k, (map.get(k) || 0) + v);
  }
  return [...map.entries()]
    .map(([key, value]) => ({ key, value, weight: total ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

function Donut({ title, data, note }) {
  return (
    <Card title={title}>
      {data.length === 0 ? (
        <div className="muted">Aucune donnée.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ width: 160, height: 160, flexShrink: 0 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="key" innerRadius={46} outerRadius={72} paddingAngle={2} stroke="none" isAnimationActive={false}>
                    {data.map((d, i) => <Cell key={d.key} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip
                    formatter={(v, n) => [fmtEur(v), n]}
                    contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="legend" style={{ flex: 1, minWidth: 180 }}>
              {data.map((d, i) => (
                <div className="legend-item" key={d.key} style={{ width: '100%', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span className="legend-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                    {d.key}
                  </span>
                  <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPct(d.weight)} · {fmtEur(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
          {note && <div className="sub muted" style={{ marginTop: 14, fontSize: 12.5 }}>{note}</div>}
        </>
      )}
    </Card>
  );
}

export default function Exposure() {
  const [positions, setPositions] = useState(null);
  const [exposure, setExposure] = useState(null);
  const [enrichPending, setEnrichPending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getPortfolio().then((d) => setPositions(d.positions)).catch((e) => setError(e.message));
    getExposure(true)
      .then(setExposure)
      .catch(() => setEnrichPending(true));
  }, []);

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!positions) return <Spinner />;
  if (!positions.length) {
    return <Card><Empty title="Aucune position">Importez d'abord un portefeuille.</Empty></Card>;
  }

  // Le serveur renvoie les répartitions enrichies ; repli client si l'endpoint échoue.
  const byCurrency = exposure?.currency?.length ? exposure.currency : groupBy(positions, (p) => p.currency);
  const byType = exposure?.asset_class?.length ? exposure.asset_class : groupBy(positions, (p) => p.product_type, 'Non typé');
  const bySector = exposure?.sector || [];
  const byCountry = exposure?.country || [];

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Donut title="Exposition par devise" data={byCurrency} note="Devise de cotation — sans neutraliser l'effet de change." />
        <Donut title="Exposition par classe d'actifs" data={byType} note="Type DEGIRO, ou déduit du nom (UCITS/ETF → ETF, Physical Gold → ETC)." />
        {bySector.length > 0 && <Donut title="Exposition par secteur" data={bySector} note="Depuis l'enrichissement ISIN (hors ETF non éclatés). Le look-through ETF affinera cette vue." />}
        {byCountry.length > 0 && <Donut title="Exposition par pays" data={byCountry} />}
      </div>
      {(enrichPending || bySector.length === 0) && (
        <div style={{ marginTop: 16 }}>
          <Banner kind="info">
            La répartition par secteur nécessite l'enrichissement ISIN (source externe) ou une saisie
            manuelle. Renseignez-la depuis <strong>Import / Réglages → Références ISIN</strong>.
          </Banner>
        </div>
      )}
    </>
  );
}
