import { useEffect, useState } from 'react';
import { getDividends } from '../lib/api.js';
import { fmtMoney, fmtDate } from '../lib/format.js';
import { Spinner, Card, Stat, Banner, Empty } from '../components/ui.jsx';

export default function Dividends({ onGoImport }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getDividends().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!data) return <Spinner />;

  if (!data.count) {
    return (
      <Card>
        <Empty title="Aucun dividende pour l'instant">
          Importe ton <strong>relevé de compte</strong> (Account.csv) depuis l'onglet{' '}
          <button className="link-btn" onClick={onGoImport}>Import / Réglages</button> pour voir tes
          dividendes perçus sur 12 mois.
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <div className="grid stat-row">
        {data.currencies.map((c) => (
          <Stat
            key={c.currency}
            label={`Perçu net · ${c.currency}`}
            value={fmtMoney(c.net, c.currency)}
            sub={`brut ${fmtMoney(c.gross, c.currency)} · retenue ${fmtMoney(c.tax, c.currency)}`}
            tone="pos"
          />
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <Banner kind="info">
          Dividendes perçus du {fmtDate(data.window.from)} au {fmtDate(data.window.to)} (12 mois glissants),
          d'après ton relevé de compte. Les devises étrangères ne sont pas converties en EUR.
        </Banner>
      </div>

      <Card title="Par titre">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Titre</th><th>Devise</th><th>Perçu (brut)</th></tr>
            </thead>
            <tbody>
              {data.payers.map((p) => (
                <tr key={(p.isin || p.name) + p.currency}>
                  <td><span className="sym">{p.name}</span>{p.isin && <span className="muted"> · {p.isin}</span>}</td>
                  <td className="muted">{p.currency}</td>
                  <td>{fmtMoney(p.gross, p.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
