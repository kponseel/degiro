import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { getPortfolio, getExposure, getLookthrough } from '../lib/api.js';
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
                  <Pie data={data} dataKey="value" nameKey="key" innerRadius={48} outerRadius={74} paddingAngle={2} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
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

function Lookthrough({ data }) {
  if (!data) return null;
  const { trueHoldings = [], overlaps = [], coveredCount = 0, missing = [], total = 0 } = data;
  if (!trueHoldings.length) return null;

  const overlapKeys = new Set(overlaps.map((o) => o.isin || `name:${(o.name || '').toLowerCase()}`));
  const isOverlap = (h) => overlapKeys.has(h.isin || `name:${(h.name || '').toLowerCase()}`);
  const top = trueHoldings.filter((h) => !/·\s*reste$/i.test(h.name)).slice(0, 15);

  return (
    <Card title="Vraie exposition (look-through ETF)" className="lookthrough">
      <p className="muted" style={{ marginTop: 0 }}>
        Chaque ETF dont la composition est importée est éclaté en ses titres. On révèle ainsi la
        <strong> vraie exposition par entreprise</strong> — et les surexpositions cachées (un titre détenu en direct
        <em> et</em> via un ETF).
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 16px' }}>
        <span className="chip">{coveredCount} ETF éclaté(s)</span>
        {overlaps.length > 0 && <span className="chip warn">{overlaps.length} surexposition(s)</span>}
        {missing.length > 0 && <span className="chip">{missing.length} ETF sans composition</span>}
      </div>

      {overlaps.length > 0 && (
        <Banner kind="warn">
          <strong>Surexposition détectée.</strong> Vous détenez {overlaps.map((o) => o.name).slice(0, 3).join(', ')}
          {overlaps.length > 3 ? '…' : ''} à la fois en direct et à l'intérieur d'un ETF. Votre exposition réelle à ces
          titres est plus élevée que ne le suggère la liste de vos positions.
        </Banner>
      )}

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Titre</th>
              <th>Direct</th>
              <th>Via ETF</th>
              <th>Total</th>
              <th>Poids réel</th>
            </tr>
          </thead>
          <tbody>
            {top.map((h) => (
              <tr key={h.isin || h.name} className={isOverlap(h) ? 'row-flag' : ''}>
                <td>
                  <span className="sym">{h.name}</span>
                  {isOverlap(h) && <span className="chip warn" style={{ marginLeft: 8 }}>surexposition</span>}
                  {h.isin && <div className="muted" style={{ fontSize: 11.5, fontFamily: 'var(--mono, ui-monospace, monospace)' }}>{h.isin}</div>}
                </td>
                <td>{h.direct > 0.005 ? fmtEur(h.direct) : <span className="muted">—</span>}</td>
                <td>{h.viaEtf > 0.005 ? fmtEur(h.viaEtf) : <span className="muted">—</span>}</td>
                <td className="sym">{fmtEur(h.total)}</td>
                <td>{fmtPct(h.weight)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {missing.length > 0 && (
        <div className="sub muted" style={{ marginTop: 14, fontSize: 12.5 }}>
          Sans composition (comptés en bloc) : {missing.map((m) => m.name || m.isin).join(', ')}. Importez leurs
          compositions depuis <strong>Import / Réglages → Compositions d'ETF</strong> pour les éclater.
        </div>
      )}
      {total > 0 && (
        <div className="sub muted" style={{ marginTop: 6, fontSize: 12.5 }}>
          Total analysé : {fmtEur(total)} · {trueHoldings.length} titres distincts après éclatement.
        </div>
      )}
    </Card>
  );
}

export default function Exposure() {
  const [positions, setPositions] = useState(null);
  const [exposure, setExposure] = useState(null);
  const [lookthrough, setLookthrough] = useState(null);
  const [enrichPending, setEnrichPending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getPortfolio().then((d) => setPositions(d.positions)).catch((e) => setError(e.message));
    getExposure(true)
      .then(setExposure)
      .catch(() => setEnrichPending(true));
    getLookthrough().then(setLookthrough).catch(() => {});
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
      {lookthrough && lookthrough.coveredCount > 0 && (
        <div style={{ marginTop: 16 }}>
          <Lookthrough data={lookthrough} />
        </div>
      )}
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
