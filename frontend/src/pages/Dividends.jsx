import { useEffect, useMemo, useState } from 'react';
import { getDividends } from '../lib/api.js';
import { fmtMoney, fmtDate } from '../lib/format.js';
import {
  Spinner, Card, Stat, Banner, Empty, SearchInput, Pager,
} from '../components/ui.jsx';
import { usePagination } from '../lib/usePagination.js';

/** Recherche libre sur le nom du payeur, son ISIN ou sa devise. */
export function filtrerPayeurs(payers, texte = '') {
  const q = texte.trim().toLowerCase();
  if (!q) return payers || [];
  return (payers || []).filter((p) => `${p.name || ''} ${p.isin || ''} ${p.currency || ''}`.toLowerCase().includes(q));
}

export default function Dividends({ onGoImport }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [texte, setTexte] = useState('');

  useEffect(() => {
    getDividends().then(setData).catch((e) => setError(e.message));
  }, []);

  const payeurs = useMemo(() => filtrerPayeurs(data?.payers, texte), [data, texte]);
  const pg = usePagination(payeurs, { taille: 25, cle: texte });

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!data) return <Spinner />;

  if (!data.count) {
    return (
      <Card>
        <Empty title="Aucun dividende pour l'instant">
          Importe ton <strong>relevé de compte</strong> (Account.csv) depuis l'onglet{' '}
          <button className="link-btn" onClick={onGoImport}>Import / Extension</button> pour voir tes
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
        {/* Paginé et cherchable : un portefeuille bien diversifié aligne des
            dizaines de payeurs, et retrouver le rendement d'UN titre revenait à
            parcourir la liste entière à l'œil. */}
        {data.payers.length > 8 && (
          <div className="filter-bar">
            <SearchInput value={texte} onChange={setTexte} placeholder="Rechercher un payeur, un ISIN…" />
          </div>
        )}
        {payeurs.length === 0 ? (
          <p className="muted" style={{ margin: '10px 0' }}>Aucun payeur ne correspond à cette recherche.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Titre</th><th className="col-opt">Devise</th><th>Perçu (brut)</th></tr>
                </thead>
                <tbody>
                  {pg.lignes.map((p) => (
                    <tr key={(p.isin || p.name) + p.currency}>
                      <td><span className="sym">{p.name}</span>{p.isin && <span className="muted"> · {p.isin}</span>}</td>
                      <td className="muted col-opt">{p.currency}</td>
                      <td>{fmtMoney(p.gross, p.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={pg.page} pages={pg.pages} total={pg.total} debut={pg.debut} taille={pg.taille}
              onPage={pg.setPage} onTaille={pg.setTaille} libelle="payeur"
            />
          </>
        )}
      </Card>
    </>
  );
}
