import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { getPortfolio, getExposure, getLookthrough } from '../lib/api.js';
import { fmtEur, fmtPct, plural } from '../lib/format.js';
import { Spinner, Card, Banner, Empty } from '../components/ui.jsx';

const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];

/** Doit rester aligné sur UNCLASSIFIED côté serveur (backend/src/services/exposure.js). */
const UNCLASSIFIED = 'Non classé';

// Gris neutre : la part non enrichie ne doit pas se lire comme une catégorie de plus.
const colorAt = (d, i) => (d.key === UNCLASSIFIED ? 'var(--ink-faint)' : PALETTE[i % PALETTE.length]);

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

/** Donut compact : les 4 répartitions tiennent sur une seule rangée. */
function Donut({ title, data, note }) {
  if (data.length === 0) return null;
  const top = data.slice(0, 6);
  const rest = data.slice(6);
  const restWeight = rest.reduce((s, d) => s + d.weight, 0);

  return (
    <div className="expo-cell">
      <div className="expo-title">{title}</div>
      <div className="expo-chart">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="key" innerRadius={30} outerRadius={46} paddingAngle={2}
              stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={d.key} fill={colorAt(d, i)} />)}
            </Pie>
            <Tooltip
              formatter={(v, n) => [fmtEur(v), n]}
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)', fontSize: 13 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="expo-legend">
        {top.map((d, i) => (
          <li key={d.key}>
            <span className="legend-dot" style={{ background: colorAt(d, i) }} />
            <span className="expo-key" title={d.key}>{d.key}</span>
            <span className="expo-pct">{fmtPct(d.weight)}</span>
          </li>
        ))}
        {rest.length > 0 && (
          <li>
            <span className="legend-dot" style={{ background: 'var(--line)' }} />
            <span className="expo-key">{rest.length} autres</span>
            <span className="expo-pct">{fmtPct(restWeight)}</span>
          </li>
        )}
      </ul>
      {note && <div className="expo-note">{note}</div>}
    </div>
  );
}

function Lookthrough({ data }) {
  const [q, setQ] = useState('');
  if (!data) return null;
  const { trueHoldings = [], overlaps = [], coveredCount = 0, missing = [], total = 0 } = data;
  if (!trueHoldings.length) return null;

  const overlapKeys = new Set(overlaps.map((o) => o.isin || `name:${(o.name || '').toLowerCase()}`));
  const isOverlap = (h) => overlapKeys.has(h.isin || `name:${(h.name || '').toLowerCase()}`);
  const named = trueHoldings.filter((h) => !/·\s*reste$/i.test(h.name));
  const needle = q.trim().toLowerCase();
  // Recherche → parcourt TOUS les titres éclatés ; sinon top 15.
  const top = needle
    ? named.filter((h) => `${h.name} ${h.isin || ''}`.toLowerCase().includes(needle))
    : named.slice(0, 15);

  return (
    <Card title="Vraie exposition (look-through ETF)" className="lookthrough">
      <p className="muted" style={{ marginTop: 0 }}>
        Chaque ETF dont la composition est importée est éclaté en ses titres. On révèle ainsi la
        <strong> vraie exposition par entreprise</strong> — et les surexpositions cachées (un titre détenu en direct
        <em> et</em> via un ETF).
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 16px' }}>
        <span className="chip">{plural(coveredCount, 'ETF éclaté', 'ETF éclatés')}</span>
        {overlaps.length > 0 && <span className="chip warn">{plural(overlaps.length, 'surexposition')}</span>}
        {missing.length > 0 && <span className="chip">{missing.length} ETF sans composition</span>}
      </div>

      {overlaps.length > 0 && (
        <Banner kind="warn">
          <strong>Surexposition détectée.</strong> Vous détenez {overlaps.map((o) => o.name).slice(0, 3).join(', ')}
          {overlaps.length > 3 ? '…' : ''} à la fois en direct et à l'intérieur d'un ETF. Votre exposition réelle à ces
          titres est plus élevée que ne le suggère la liste de vos positions.
        </Banner>
      )}

      <div className="filter-bar" style={{ marginTop: 14, marginBottom: 10 }}>
        <input
          className="input filter-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un titre dans tes ETF éclatés…"
          aria-label="Rechercher un titre"
        />
        <div className="filter-meta">
          <span className="muted">{top.length}{needle ? '' : ` / ${named.length}`}</span>
          {needle && <button className="link-btn" onClick={() => setQ('')}>Réinitialiser</button>}
        </div>
      </div>
      <div className="table-wrap">
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
            {top.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '16px' }}>Aucun titre ne correspond.</td></tr>
            )}
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

export default function Exposure({ onGoImport }) {
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
    return (
      <Card>
        <Empty title="Aucune position">
          Importe d'abord ton portefeuille pour voir tes expositions.
          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={onGoImport}>Importer mon portefeuille</button>
          </div>
        </Empty>
      </Card>
    );
  }

  // Le serveur renvoie les répartitions enrichies ; repli client si l'endpoint échoue.
  const byCurrency = exposure?.currency?.length ? exposure.currency : groupBy(positions, (p) => p.currency);
  const byType = exposure?.asset_class?.length ? exposure.asset_class : groupBy(positions, (p) => p.product_type, 'Non typé');
  const bySector = exposure?.sector || [];
  const byCountry = exposure?.country || [];
  // Les poids portent désormais sur le portefeuille entier : on chiffre la part non enrichie
  // pour que l'utilisateur sache sur quelle assiette réelle le camembert repose.
  const sectorUnknown = bySector.find((d) => d.key === UNCLASSIFIED)?.weight || 0;
  const countryUnknown = byCountry.find((d) => d.key === UNCLASSIFIED)?.weight || 0;
  // Un camembert 100 % « Non classé » n'apprend rien : on le masque au profit de l'alerte.
  const hasSector = bySector.some((d) => d.key !== UNCLASSIFIED);
  const hasCountry = byCountry.some((d) => d.key !== UNCLASSIFIED);

  return (
    <>
      <Card title="Répartitions">
        <div className="expo-grid">
          <Donut title="Devise" data={byCurrency} note="Devise de cotation — sans neutraliser l'effet de change." />
          <Donut title="Classe d'actifs" data={byType} note="Type DEGIRO, ou déduit du nom (UCITS/ETF → ETF)." />
          {hasSector && (
            <Donut title="Secteur" data={bySector} note={sectorUnknown > 0
              ? '« Non classé » = ETF et ISIN sans secteur renseigné. Le look-through affine cette vue.'
              : 'Hors ETF non éclatés — le look-through affine cette vue.'} />
          )}
          {hasCountry && (
            <Donut title="Pays" data={byCountry} note={countryUnknown > 0
              ? 'Pour les ETF, pays de domiciliation. « Non classé » = ISIN dont le pays reste inconnu.'
              : 'Pour les ETF, pays de domiciliation.'} />
          )}
        </div>
      </Card>
      {lookthrough && lookthrough.coveredCount > 0 && (
        <div style={{ marginTop: 14 }}>
          <Lookthrough data={lookthrough} />
        </div>
      )}
      {(enrichPending || sectorUnknown > 0) && (
        <div style={{ marginTop: 16 }}>
          <Banner kind="info">
            {enrichPending || !hasSector ? (
              <>La répartition par secteur nécessite l'enrichissement ISIN (source externe) ou une saisie manuelle.</>
            ) : (
              <><strong>{fmtPct(sectorUnknown)} du portefeuille n'a pas de secteur renseigné</strong> (ETF et ISIN non
              enrichis) : ces lignes sont regroupées sous « Non classé » dans le camembert ci-dessus.</>
            )}{' '}
            Renseignez-les depuis <strong>Import / Réglages → Références ISIN</strong>.
          </Banner>
        </div>
      )}
    </>
  );
}
