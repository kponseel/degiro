import { useEffect, useState } from 'react';
import { getNews } from '../lib/api.js';
import { Spinner, Card, Banner, Empty } from '../components/ui.jsx';
import StockLinks from '../components/StockLinks.jsx';

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

export default function News({ onGoImport }) {
  const [data, setData] = useState(null);
  const [symbol, setSymbol] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function load(sym, refresh = false) {
    setBusy(true);
    getNews(sym || undefined, refresh)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.body?.error || e.message))
      .finally(() => setBusy(false));
  }

  useEffect(() => { load('', false); }, []);

  if (error && !data) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!data) return <Spinner />;

  const { stocks = [], items = [], available } = data;
  const selected = stocks.find((s) => s.isin === symbol);

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

  return (
    <>
      <Card title="Filtrer par titre">
        <div className="chip-row">
          <button className={`chip filter ${!symbol ? 'on' : ''}`} onClick={() => { setSymbol(''); load('', false); }}>
            Tous
          </button>
          {stocks.map((s) => (
            <button key={s.isin} className={`chip filter ${symbol === s.isin ? 'on' : ''}`}
              onClick={() => { setSymbol(s.isin); load(s.isin, false); }}>
              {s.name}
            </button>
          ))}
        </div>
        {selected && (
          <div style={{ marginTop: 14 }}>
            <div className="sub muted" style={{ marginBottom: 6 }}>Pages finance de {selected.name} :</div>
            <StockLinks stock={selected} />
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 2px 12px', gap: 12, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ margin: 0 }}>Actualités {selected ? `— ${selected.name}` : '— tout le portefeuille'}</div>
        <button className="btn ghost" style={{ padding: '6px 12px', fontSize: 13 }} disabled={busy} onClick={() => load(symbol, true)}>
          {busy ? 'Chargement…' : 'Rafraîchir'}
        </button>
      </div>

      {!available && (
        <Banner kind="info">
          Aucune actualité récupérée pour le moment (source publique momentanément indisponible, ou secteurs/tickers pas
          encore enrichis). Lance l'enrichissement depuis <strong>Import / Réglages</strong> puis rafraîchis.
        </Banner>
      )}

      {items.length > 0 && (
        <div className="news-list">
          {items.map((it, i) => (
            <a key={`${it.link}-${i}`} className="news-item" href={it.link} target="_blank" rel="noopener noreferrer">
              <div className="news-title">{it.title}</div>
              <div className="news-meta">
                {it.stock && <span className="chip sm">{it.stock}</span>}
                {it.source && <span>{it.source}</span>}
                {it.pubDate && <span className="muted">· {relDate(it.pubDate)}</span>}
              </div>
            </a>
          ))}
        </div>
      )}
      {available && items.length === 0 && (
        <div className="muted" style={{ marginTop: 12 }}>Aucune actualité pour ce titre.</div>
      )}
    </>
  );
}
