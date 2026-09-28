import { useEffect, useMemo, useState } from 'react';
import { getNews } from '../lib/api.js';
import { Spinner, Card, Banner, Empty, SearchInput } from '../components/ui.jsx';
import { raccourcisTitre, MARCHE } from '../lib/links.js';
import { sectorColorIndex, distinctSectors } from '../lib/newsFilter.js';

/**
 * Page « Actus » — des RACCOURCIS, plus un flux récupéré côté serveur.
 *
 * L'application interrogeait Google News depuis le serveur. Sur un hébergement
 * mutualisé, ces appels sont refusés ou limités en débit : la page restait figée
 * sur un cache périmé, le bouton « Actualiser » n'avait aucun effet visible, et
 * rien ne distinguait « aucune actualité pour tes titres » de « la source ne
 * nous répond plus ».
 *
 * Le navigateur de l'utilisateur, lui, n'est bloqué par personne. Lui donner le
 * lien marche toujours, ne périme jamais, ne demande aucune clé d'API, et donne
 * accès à la source complète plutôt qu'aux cinq titres qu'un flux RSS voulait
 * bien nous céder.
 */

/** Rangée de liens externes, ouverts dans un nouvel onglet. */
function Liens({ liens, taille = '' }) {
  return (
    <div className="chip-row">
      {liens.map((l) => (
        <a
          key={l.label}
          className={`chip link-chip ${taille}`}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {l.label} ↗
        </a>
      ))}
    </div>
  );
}

export function filtrerTitres(stocks, texte, secteur) {
  const q = String(texte || '').trim().toLowerCase();
  return (stocks || []).filter((s) => {
    if (secteur && (s.sector || 'Non classé') !== secteur) return false;
    if (!q) return true;
    return `${s.name || ''} ${s.isin || ''} ${s.ticker || ''}`.toLowerCase().includes(q);
  });
}

export default function News({ onGoImport }) {
  const [stocks, setStocks] = useState(null);
  const [error, setError] = useState(null);
  const [texte, setTexte] = useState('');
  const [secteur, setSecteur] = useState(null);

  // On ne demande plus au serveur que la LISTE des titres détenus : aucune
  // requête sortante, donc aucune panne possible côté source.
  useEffect(() => {
    getNews()
      .then((d) => setStocks(d.stocks || []))
      .catch((e) => setError(e.body?.error || e.message));
  }, []);

  const secteurs = useMemo(() => distinctSectors(stocks || []), [stocks]);
  const visibles = useMemo(() => filtrerTitres(stocks, texte, secteur), [stocks, texte, secteur]);

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!stocks) return <Spinner />;

  return (
    <>
      <div className="page-head">
        <h1>Actus &amp; raccourcis</h1>
        <p>
          Un clic vers l'actualité et les données de chacun de tes titres, à la source.
          Les liens s'ouvrent dans un nouvel onglet.
        </p>
      </div>

      <Card title="Marchés">
        {MARCHE.map((bloc) => (
          <div key={bloc.groupe} style={{ marginBottom: 14 }}>
            <div className="filter-label">{bloc.groupe}</div>
            <Liens liens={bloc.liens} />
          </div>
        ))}
      </Card>

      {stocks.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <Card>
            <Empty title="Aucun titre à suivre">
              Importe ton portefeuille pour retrouver ici l'actualité de chacune de tes lignes.
              <div style={{ marginTop: 14 }}>
                <button className="btn" onClick={onGoImport}>Importer mon portefeuille</button>
              </div>
            </Empty>
          </Card>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <Card title={`Tes titres (${stocks.length})`}>
            <div className="filter-bar">
              <SearchInput value={texte} onChange={setTexte} placeholder="Rechercher un titre…" />
              {secteurs.length > 1 && (
                <div className="chip-row">
                  <button
                    type="button"
                    className={`chip filter ${secteur === null ? 'on' : ''}`}
                    aria-pressed={secteur === null}
                    onClick={() => setSecteur(null)}
                  >
                    Tous
                  </button>
                  {secteurs.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      className={`chip filter sector ${secteur === sec ? 'on' : ''}`}
                      aria-pressed={secteur === sec}
                      onClick={() => setSecteur(secteur === sec ? null : sec)}
                    >
                      <span className="sector-dot" style={{ background: `var(--c${sectorColorIndex(sec)})` }} />
                      {sec}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {visibles.length === 0 ? (
              <p className="muted" style={{ margin: '18px 0' }}>Aucun titre ne correspond à ce filtre.</p>
            ) : (
              <div className="ql-list">
                {visibles.map((s) => (
                  <div key={s.isin || s.name} className="ql-row">
                    <div className="ql-head">
                      <span className="sym">{s.name}</span>
                      {s.sector && (
                        <span className="muted sm">
                          <span className="sector-dot" style={{ background: `var(--c${sectorColorIndex(s.sector)})` }} />
                          {s.sector}
                        </span>
                      )}
                      {s.ticker && <span className="muted sm">· {s.ticker}</span>}
                    </div>
                    {/* Actualité d'abord — c'est ce qu'on vient chercher ici —
                        puis les pages de données, plus discrètes. */}
                    <Liens liens={raccourcisTitre(s).actu} />
                    <Liens liens={raccourcisTitre(s).donnees} taille="sm" />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Banner kind="info">
          Ces raccourcis remplacent le flux d'articles d'avant. Il était récupéré par le serveur, dont les
          appels sortants sont filtrés chez l'hébergeur : la liste restait figée sans jamais dire pourquoi.
          Ouverts depuis ton navigateur, ces liens fonctionnent toujours — et te donnent la source complète.
        </Banner>
      </div>
    </>
  );
}
