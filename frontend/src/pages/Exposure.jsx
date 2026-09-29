import { useEffect, useMemo, useState } from 'react';
import { getPortfolio, getLookthrough } from '../lib/api.js';
import { fmtEur, fmtPct, fmtNum, plural } from '../lib/format.js';
import { Spinner, Card, Banner, Empty } from '../components/ui.jsx';
import { BarList, Heatmap } from '../components/Charts.jsx';
import PositionDrawer from '../components/PositionDrawer.jsx';
import { usePersistentState } from '../lib/useFilters.js';
import {
  analyzePortfolio, breakdown, diversification, crossTab, hasLookthrough, FUNDS, UNCLASSIFIED,
} from '../lib/portfolioAnalytics.js';

/** Tuile de score : un chiffre, et ce qu'il veut dire. */
function Score({ label, value, sub }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

function Lookthrough({ data }) {
  const [q, setQ] = useState('');
  const { trueHoldings = [], overlaps = [], coveredCount = 0, missing = [], total = 0 } = data;
  const overlapKeys = new Set(overlaps.map((o) => o.isin || `name:${(o.name || '').toLowerCase()}`));
  const isOverlap = (h) => overlapKeys.has(h.isin || `name:${(h.name || '').toLowerCase()}`);
  const named = trueHoldings.filter((h) => !/·\s*reste$/i.test(h.name));
  const needle = q.trim().toLowerCase();
  // Recherche → parcourt TOUS les titres éclatés ; sinon les 15 premiers.
  const top = needle
    ? named.filter((h) => `${h.name} ${h.isin || ''}`.toLowerCase().includes(needle))
    : named.slice(0, 15);

  return (
    <Card title="Tes vrais premiers titres (ETF éclatés)" className="ana-block">
      <div className="chip-row" style={{ marginBottom: 12 }}>
        <span className="chip">{plural(coveredCount, 'ETF éclaté', 'ETF éclatés')}</span>
        {overlaps.length > 0 && <span className="chip warn">{plural(overlaps.length, 'surexposition')}</span>}
        {missing.length > 0 && <span className="chip">{missing.length} ETF sans composition</span>}
      </div>
      {overlaps.length > 0 && (
        <Banner kind="warn">
          <strong>Surexposition :</strong> {overlaps.map((o) => o.name).slice(0, 3).join(', ')}
          {overlaps.length > 3 ? '…' : ''} — détenu{overlaps.length > 1 ? 's' : ''} en direct et à l'intérieur d'un ETF.
        </Banner>
      )}
      <div className="filter-bar" style={{ marginTop: 12, marginBottom: 10 }}>
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
        <table className="data compact">
          <thead>
            <tr>
              <th>Titre</th>
              <th className="col-opt">Direct</th>
              <th className="col-opt">Via ETF</th>
              <th>Total</th>
              <th>Poids réel</th>
            </tr>
          </thead>
          <tbody>
            {top.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 16 }}>Aucun titre ne correspond.</td></tr>
            )}
            {top.map((h) => (
              <tr key={h.isin || h.name} className={isOverlap(h) ? 'row-flag' : ''}>
                <td className="col-titre">
                  <div className="pos-name">{h.name}</div>
                  <div className="pos-sub muted">
                    {isOverlap(h) ? 'direct + ETF' : h.direct > 0.005 ? 'en direct' : 'via ETF'}
                    {h.isin ? ` · ${h.isin}` : ''}
                  </div>
                </td>
                <td className="col-opt">{h.direct > 0.005 ? fmtEur(h.direct) : <span className="muted">—</span>}</td>
                <td className="col-opt">{h.viaEtf > 0.005 ? fmtEur(h.viaEtf) : <span className="muted">—</span>}</td>
                <td className="sym">{fmtEur(h.total)}</td>
                <td>{fmtPct(h.weight)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && (
        <div className="ana-note">
          Sans composition (comptés en bloc dans « {FUNDS} ») : {missing.map((m) => m.name || m.isin).join(', ')}.
        </div>
      )}
      {total > 0 && (
        <div className="ana-note">
          Total analysé : {fmtEur(total)} · {trueHoldings.length} titres distincts après éclatement.
        </div>
      )}
    </Card>
  );
}

/**
 * Un score de diversification calculé sur 15 % des titres ne dit rien du
 * portefeuille : sous 50 % d'assiette classée, on affiche l'assiette plutôt
 * qu'un chiffre trompeur.
 */
const MIN_COVERAGE = 0.5;
const scoreValue = (d, unit) => (d.count && d.coverage >= MIN_COVERAGE ? `${fmtNum(d.effective, 1)} ${unit}` : '—');
const scoreSub = (d, text, none) => {
  if (!d.count) return none;
  if (d.coverage < MIN_COVERAGE) return `seulement ${fmtPct(d.coverage)} des titres classés`;
  return text(d) + (d.coverage < 0.95 ? ` · sur ${fmtPct(d.coverage)} des titres` : '');
};

const CARDS = [
  { dim: 'sector', title: 'Secteurs' },
  { dim: 'region', title: 'Régions' },
  { dim: 'country', title: 'Pays' },
  { dim: 'currency', title: 'Devises économiques', note: 'Devise du pays de chaque société : un ETF monde coté en euros reste exposé au dollar.' },
  { dim: 'quote', title: 'Devises de cotation', note: 'Devise dans laquelle la ligne est cotée — ce que tu paies, pas ce à quoi tu es exposé.' },
  { dim: 'type', title: "Classes d'actifs" },
];

export default function Exposure({ onGoImport }) {
  const [data, setData] = useState(null);
  const [lookthrough, setLookthrough] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [view, setView] = usePersistentState('degiro_expo_view', { mode: 'lookthrough' });

  useEffect(() => {
    getPortfolio().then(setData).catch((e) => setError(e.message));
    getLookthrough().then(setLookthrough).catch(() => setLookthrough(null));
  }, []);

  const a = useMemo(() => (data?.snapshot ? analyzePortfolio(data) : null), [data]);
  const canExplode = hasLookthrough(lookthrough);
  const exploded = canExplode && view.mode === 'lookthrough';
  const lt = exploded ? lookthrough : null;

  const rows = useMemo(() => {
    if (!a) return {};
    return Object.fromEntries(CARDS.map((c) => [c.dim, breakdown(a.lines, c.dim, lt)]));
  }, [a, lt]);
  const tab = useMemo(() => (a ? crossTab(a.lines, lt) : null), [a, lt]);

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!data) return <Spinner />;
  if (!a || !a.lines.length) {
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

  const dSector = diversification(rows.sector);
  const dRegion = diversification(rows.region);
  const eurShare = rows.currency.find((r) => r.key === 'EUR')?.weight || 0;
  const fundsShare = rows.sector.find((r) => r.key === FUNDS)?.weight || 0;
  const knownCurrency = rows.currency.filter((r) => r.key !== FUNDS && r.key !== UNCLASSIFIED).reduce((s, r) => s + r.weight, 0);
  const foreign = Math.max(0, knownCurrency - eurShare);
  const unclassified = rows.sector.find((r) => r.key === UNCLASSIFIED)?.weight || 0;
  const pickItem = (it) => setSelected(a.lines.find((l) => l.isin === it.isin) || null);

  return (
    <>
      <div className="page-head page-head-row">
        <div>
          <h1>Exposition</h1>
          <p>
            Où ton argent est réellement placé : secteurs, régions, devises.
            {exploded ? ' Vue éclatée : chaque ETF est remplacé par ses titres.' : ' Vue directe : tes lignes telles quelles.'}
          </p>
        </div>
        {canExplode && (
          <div className="pb-seg" role="radiogroup" aria-label="Vue">
            {[['lookthrough', 'ETF éclatés'], ['direct', 'Lignes directes']].map(([m, label]) => (
              <button key={m} type="button" role="radio" aria-checked={view.mode === m}
                className={view.mode === m ? 'on' : ''} onClick={() => setView({ mode: m })}>{label}</button>
            ))}
          </div>
        )}
      </div>

      <div className="kpi-strip ana-kpis">
        <Score
          label="Diversification sectorielle"
          value={scoreValue(dSector, 'secteurs')}
          sub={scoreSub(dSector, (d) => `effectifs sur ${d.count} · 1er : ${d.top.key} ${fmtPct(d.top.weight)}`, 'secteurs non renseignés')}
        />
        <Score
          label="Diversification géographique"
          value={scoreValue(dRegion, 'régions')}
          sub={scoreSub(dRegion, (d) => `effectives · 1re : ${d.top.key} ${fmtPct(d.top.weight)}`, 'pays non renseignés')}
        />
        <Score
          label="Exposition hors euro"
          value={fmtPct(foreign)}
          sub={`±10 % sur les devises ≈ ±${fmtEur(a.invested * foreign * 0.1)}`}
        />
        <Score
          label={exploded ? 'Part non éclatée' : 'Part en ETF'}
          value={fmtPct(exploded ? fundsShare : a.funds)}
          sub={exploded ? 'ETF sans composition importée' : canExplode ? 'passe en vue « ETF éclatés »' : 'importe leurs compositions pour les éclater'}
        />
      </div>

      {(unclassified >= 0.1 || fundsShare >= 0.1) && (
        <Banner kind="info">
          {fundsShare >= 0.1 && (
            <><strong>{fmtPct(fundsShare)} de tes titres sont des ETF {exploded ? 'sans composition' : 'non éclatés'}</strong> : ils
            restent à part plutôt que comptés dans leur pays de domiciliation (Irlande, Luxembourg…), qui ne dit rien de ce
            qu'ils contiennent. Importe leur composition dans <strong>Import / Extension → Compositions d'ETF</strong>. </>
          )}
          {unclassified >= 0.1 && (
            <><strong>{fmtPct(unclassified)} sans secteur</strong> : lance l'enrichissement ou complète-les dans
            {' '}<strong>Import / Extension → Références ISIN</strong>.</>
          )}
        </Banner>
      )}

      <div className="expo-cards">
        {CARDS.map((c) => (
          <Card key={c.dim} title={c.title}>
            <BarList rows={rows[c.dim]} limit={c.dim === 'country' ? 10 : 8} onItem={pickItem} />
            {c.note && <p className="ana-note">{c.note}</p>}
          </Card>
        ))}
      </div>

      {tab && tab.rows.length > 1 && tab.cols.length > 1 && (
        <Card title="Secteurs × régions" className="ana-block">
          <Heatmap tab={tab} rowLabel="Secteur" />
          <p className="ana-note">Part de la valeur des titres dans chaque case. Plus la case est foncée, plus elle pèse.</p>
        </Card>
      )}

      {canExplode && <Lookthrough data={lookthrough} />}

      <PositionDrawer
        position={selected}
        lookthrough={lookthrough}
        onAnalyze={(p) => { window.location.hash = `#/ai?isin=${encodeURIComponent(p.isin)}`; }}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
