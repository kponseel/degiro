import { useEffect, useState } from 'react';
import { getPortfolio } from '../lib/api.js';
import { fmtEur, fmtPct, fmtNum } from '../lib/format.js';
import { Spinner, Card, Stat, Banner, Empty } from '../components/ui.jsx';

export default function Overview({ onGoImport }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getPortfolio().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!data) return <Spinner />;

  if (!data.snapshot) {
    return (
      <Card>
        <Empty title="Aucune donnée pour l'instant">
          Importez un export DEGIRO (Portfolio.csv) depuis l'onglet{' '}
          <button className="link-btn" onClick={onGoImport}>Import / Réglages</button> pour voir votre portefeuille.
        </Empty>
      </Card>
    );
  }

  const { snapshot, positions } = data;
  const totalPos = positions.reduce((s, p) => s + (Number(p.value_eur) || 0), 0);
  const totalValue = Number(snapshot.total_value_eur) || totalPos;
  const totalPl = positions.reduce((s, p) => s + (Number(p.pl_eur) || 0), 0);
  const hasPl = positions.some((p) => p.pl_eur !== null && p.pl_eur !== undefined);

  // Concentration
  const weighted = positions
    .map((p) => ({ ...p, w: totalPos ? (Number(p.value_eur) || 0) / totalPos : 0 }))
    .sort((a, b) => b.w - a.w);
  const top5 = weighted.slice(0, 5).reduce((s, p) => s + p.w, 0);
  const hhi = weighted.reduce((s, p) => s + p.w * p.w, 0);
  const maxW = weighted[0]?.w || 0;
  const overConcentrated = maxW > 0.25 || top5 > 0.6;

  return (
    <>
      <div className="grid stat-row">
        <Stat label="Valeur totale" value={fmtEur(totalValue)} sub={`au ${String(snapshot.snapshot_date).slice(0, 10)}`} />
        <Stat label="Liquidités" value={fmtEur(snapshot.cash_eur)} />
        <Stat label="Lignes" value={fmtNum(positions.length, 0)} sub={snapshot.source === 'csv' ? 'source : import CSV' : 'source : extension'} />
        <Stat
          label="P/L latent"
          value={hasPl ? fmtEur(totalPl) : '—'}
          sub={hasPl && totalValue ? `${fmtPct(totalPl / (totalValue - totalPl))}` : 'non fourni par la source'}
          tone={hasPl ? (totalPl >= 0 ? 'pos' : 'neg') : ''}
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', marginBottom: 16 }}>
        <Card title="Concentration — 5 premières lignes">
          {overConcentrated && (
            <div style={{ marginBottom: 14 }}>
              <Banner kind="warn">
                Surconcentration : {fmtPct(top5)} du portefeuille sur 5 lignes
                {maxW > 0.25 ? `, dont ${fmtPct(maxW)} sur une seule (${weighted[0].symbol || weighted[0].name}).` : '.'}
              </Banner>
            </div>
          )}
          <div className="bars">
            {weighted.slice(0, 5).map((p) => (
              <div className="bar-row" key={p.isin}>
                <span className="name">{p.symbol || p.name || p.isin}</span>
                <span className="amt">{fmtPct(p.w)} · {fmtEur(p.value_eur)}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, p.w * 100)}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="sub muted" style={{ marginTop: 14, fontSize: 12.5 }}>
            Indice de Herfindahl : {fmtNum(hhi, 3)} · Poids max : {fmtPct(maxW)}
          </div>
        </Card>
      </div>

      <Card title="Positions">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Titre</th><th>Type</th><th>Qté</th><th>Cours</th><th>Dev.</th>
                <th>Valeur (EUR)</th><th>Poids</th><th>P/L (EUR)</th>
              </tr>
            </thead>
            <tbody>
              {weighted.map((p) => {
                const ac = p.asset_class || p.product_type;
                const isFund = ac === 'ETF' || ac === 'ETC';
                return (
                <tr key={p.isin}>
                  <td><span className="sym">{p.symbol || '—'}</span> <span className="muted">{p.name || p.isin}</span></td>
                  <td>{ac ? <span className={`chip ${isFund ? 'etf' : 'stock'}`}>{ac}</span> : <span className="muted">—</span>}</td>
                  <td>{fmtNum(p.qty, 0)}</td>
                  <td>{fmtNum(p.price)}</td>
                  <td className="muted">{p.currency || '—'}</td>
                  <td>{fmtEur(p.value_eur)}</td>
                  <td>{fmtPct(p.w)}</td>
                  <td className={p.pl_eur >= 0 ? 'pos' : 'neg'}>{p.pl_eur != null ? fmtEur(p.pl_eur) : '—'}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
