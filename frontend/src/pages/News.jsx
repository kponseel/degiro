import { useEffect, useMemo, useState } from 'react';
import { getNews } from '../lib/api.js';
import { Spinner, Card, Banner, Empty } from '../components/ui.jsx';
import StockLinks from '../components/StockLinks.jsx';
import { sectorColorIndex, distinctSectors, filterNews, toggleInSet, newsStatus, relTime } from '../lib/newsFilter.js';

function relDate(s) {
  if (!s) return '';
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const h = Math.round(diff / 3.6e6);
  if (h < 1) return "à l'instant";
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(t).toLocaleDateString('fr-FR');
}

/** Pastille colorée par secteur (var(--c1..8) ; neutre si secteur inconnu). */
function sectorStyle(sector) {
  const i = sectorColorIndex(sector);
  if (!i) return {};
  const c = `var(--c${i})`;
  return {
    color: c,
    background: `color-mix(in srgb, ${c} 12%, transparent)`,
    borderColor: `color-mix(in srgb, ${c} 34%, transparent)`,
  };
}

export default function News({ onGoImport }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selStocks, setSelStocks] = useState(new Set());
  const [selSectors, setSelSectors] = useState(new Set());

  // On charge TOUTES les actus une fois, puis on filtre côté client : ça rend
  // le multi-choix instantané (pas de rechargement à chaque clic).
  function load(refresh = false) {
    setBusy(true);
    getNews(undefined, refresh)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.body?.error || e.message))
      .finally(() => setBusy(false));
  }
  useEffect(() => { load(false); }, []);

  const stocks = data?.stocks || [];
  const items = data?.items || [];
  const sectors = useMemo(() => distinctSectors(stocks), [stocks]);
  const filtered = useMemo(() => filterNews(items, selStocks, selSectors), [items, selStocks, selSectors]);
  const nameByIsin = useMemo(() => Object.fromEntries(stocks.map((s) => [s.isin, s.name])), [stocks]);
  const activeFilters = selStocks.size + selSectors.size;
  const status = newsStatus(data || {});
  const fetchedLabel = relTime(data?.fetchedAt);

  if (error && !data) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!data) return <Spinner />;

  if (!stocks.length) {
    return (
      <Card>
        <Empty title="Aucun titre à suivre">
          Importe ton portefeuille pour voir l'actualité de tes positions.
          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={onGoImport}>Importer mon portefeuille</button>
          </div>
        </Empty>
      </Card>
    );
  }

  const soloStock = selStocks.size === 1 ? stocks.find((s) => selStocks.has(s.isin)) : null;

  return (
    <>
      <Card title="Filtrer les actualités">
        {sectors.length > 0 && (
          <>
            <div className="filter-label">Par secteur <span className="muted">(multi-choix)</span></div>
            <div className="chip-row">
              {sectors.map((sec) => {
                const on = selSectors.has(sec);
                return (
                  <button
                    key={sec}
                    className={`chip filter sector ${on ? 'on' : ''}`}
                    style={on ? undefined : sectorStyle(sec)}
                    onClick={() => setSelSectors((s) => toggleInSet(s, sec))}
                    aria-pressed={on}
                  >
                    <span className="sector-dot" style={{ background: `var(--c${sectorColorIndex(sec)})` }} />
                    {sec}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="filter-label" style={{ marginTop: sectors.length ? 14 : 0 }}>Par titre <span className="muted">(multi-choix)</span></div>
        <div className="chip-row">
          {stocks.map((s) => {
            const on = selStocks.has(s.isin);
            return (
              <button
                key={s.isin}
                className={`chip filter ${on ? 'on' : ''}`}
                style={on ? undefined : sectorStyle(s.sector)}
                onClick={() => setSelStocks((prev) => toggleInSet(prev, s.isin))}
                aria-pressed={on}
                title={s.sector || ''}
              >
                {s.name}
              </button>
            );
          })}
        </div>

        {activeFilters > 0 && (
          <button className="link-btn" style={{ marginTop: 12 }} onClick={() => { setSelStocks(new Set()); setSelSectors(new Set()); }}>
            Réinitialiser les filtres ({activeFilters})
          </button>
        )}

        {soloStock && (
          <div style={{ marginTop: 14 }}>
            <div className="sub muted" style={{ marginBottom: 6 }}>Pages finance de {soloStock.name} :</div>
            <StockLinks stock={soloStock} />
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 2px 12px', gap: 12, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ margin: 0 }}>
          Actualités <span className="muted" style={{ fontWeight: 500 }}>· {filtered.length} article{filtered.length > 1 ? 's' : ''}{activeFilters > 0 ? ' filtré' + (filtered.length > 1 ? 's' : '') : ''}</span>
        </div>
        {/* Dater la récupération : sans cela, un rafraîchissement qui ramène les
            mêmes articles — le cas courant — est indiscernable d'un bouton mort. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {fetchedLabel && (
            <span className="muted" style={{ fontSize: 12.5 }} aria-live="polite">
              Actualisé {fetchedLabel}
            </span>
          )}
          <button className="btn ghost" style={{ padding: '6px 12px', fontSize: 13 }} disabled={busy} onClick={() => load(true)}>
            {busy ? 'Chargement…' : 'Rafraîchir'}
          </button>
        </div>
      </div>

      {status.message && (
        <Banner kind={status.kind === 'empty' ? 'info' : 'warn'}>{status.message}</Banner>
      )}

      {filtered.length > 0 && (
        <div className="news-list">
          {filtered.map((it, i) => (
            <a key={`${it.link}-${i}`} className="news-item" href={it.link} target="_blank" rel="noopener noreferrer"
              style={{ borderLeftColor: `var(--c${sectorColorIndex(it.sector)})` }}>
              <div className="news-title">{it.title}</div>
              <div className="news-meta">
                <span className="chip sm" style={sectorStyle(it.sector)}>{it.stock || nameByIsin[it.isin] || '—'}</span>
                {it.sector && <span className="muted" style={{ fontSize: 11.5 }}>{it.sector}</span>}
                {it.source && <span>{it.source}</span>}
                {it.pubDate && <span className="muted">· {relDate(it.pubDate)}</span>}
              </div>
            </a>
          ))}
        </div>
      )}
      {data.available && filtered.length === 0 && (
        <div className="muted" style={{ marginTop: 12 }}>
          {activeFilters > 0 ? 'Aucune actualité ne correspond à ces filtres.' : 'Aucune actualité pour le moment.'}
        </div>
      )}
    </>
  );
}
