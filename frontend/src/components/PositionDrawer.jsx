import { useEffect, useRef } from 'react';
import { fmtEur, fmtPct, fmtNum, fmtDate } from '../lib/format.js';
import StockLinks from './StockLinks.jsx';
import { newsLinks } from '../lib/links.js';
import { InsightBadge } from './InsightPasteModal.jsx';
import { RECOMMENDATION_LABELS } from '../../../shared/aiInsightContract.js';

/** Puce à puces d'une liste bull/bear (limitée pour rester lisible). */
function Points({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="dr-ai-points">
      <span className="dr-ai-points-t">{title}</span>
      <ul>{items.slice(0, 4).map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="dr-row">
      <span className="dr-label">{label}</span>
      <span className="dr-value">{children}</span>
    </div>
  );
}

/**
 * Panneau latéral de détail d'une position : chiffres clés, classification,
 * exposition réelle (direct + via ETF), actualités du titre et liens finance.
 * Ferme sur Échap / clic extérieur ; le focus est piégé le temps de l'ouverture.
 */
export default function PositionDrawer({ position, lookthrough, insight, onClose, onAnalyze }) {
  const panelRef = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => {
    if (!position) return undefined;
    previousFocus.current = document.activeElement;

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      // Piège à focus : la tabulation reste dans le panneau.
      const f = panelRef.current?.querySelectorAll('a[href], button, input, select, [tabindex]:not([tabindex="-1"])');
      if (!f?.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    setTimeout(() => panelRef.current?.querySelector('button')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      previousFocus.current?.focus?.();
    };
  }, [position, onClose]);

  if (!position) return null;

  const p = position;
  const lt = lookthrough?.trueHoldings?.find((h) => h.isin === p.isin);
  const viaEtf = lt?.viaEtf || 0;
  const hasOverlap = viaEtf > 0.005 && (lt?.direct || 0) > 0.005;
  const pl = p.pl_eur != null ? Number(p.pl_eur) : null;

  return (
    <>
      <div className="scrim drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="pos-drawer" ref={panelRef} role="dialog" aria-modal="true" aria-label={`Détail ${p.name || p.isin}`}>
        <header className="dr-head">
          <div style={{ minWidth: 0 }}>
            <div className="dr-ticker">{p.symbol || p.ticker || '—'}</div>
            <div className="dr-name">{p.name || p.isin}</div>
            <div className="muted dr-isin">{p.isin}</div>
          </div>
          <button className="btn ghost dr-close" onClick={onClose} aria-label="Fermer le panneau">✕</button>
        </header>

        <div className="dr-body">
          <div className="dr-kpis">
            <div className="dr-kpi">
              <span className="dr-kpi-label">Valeur</span>
              <span className="dr-kpi-value">{fmtEur(p.value_eur)}</span>
            </div>
            <div className="dr-kpi">
              <span className="dr-kpi-label">Poids</span>
              <span className="dr-kpi-value">{fmtPct(p.w)}</span>
            </div>
            <div className="dr-kpi">
              <span className="dr-kpi-label">P/L latent</span>
              <span className={`dr-kpi-value ${pl == null ? '' : pl >= 0 ? 'pos' : 'neg'}`}>
                {pl == null ? '—' : `${pl >= 0 ? '+' : ''}${fmtEur(pl)}`}
              </span>
            </div>
          </div>

          <section className="dr-section">
            <h4>Position</h4>
            <Row label="Quantité">{fmtNum(p.qty, 0)}</Row>
            <Row label="Cours">{fmtNum(p.price)} {p.currency || ''}</Row>
            {p.break_even_price != null && <Row label="Prix de revient">{fmtNum(p.break_even_price)}</Row>}
            <Row label="Type">{p.asset_class || p.product_type || '—'}</Row>
            <Row label="Secteur">{p.sector || <span className="muted">non renseigné</span>}</Row>
            <Row label="Pays">{p.country || <span className="muted">non renseigné</span>}</Row>
          </section>

          {(viaEtf > 0.005 || lt) && (
            <section className="dr-section">
              <h4>Exposition réelle {hasOverlap && <span className="chip warn">surexposition</span>}</h4>
              <Row label="En direct">{fmtEur(lt?.direct || 0)}</Row>
              <Row label="Via tes ETF">{viaEtf > 0.005 ? fmtEur(viaEtf) : <span className="muted">—</span>}</Row>
              <Row label="Total réel"><strong>{fmtEur(lt?.total ?? p.value_eur)}</strong></Row>
              {hasOverlap && (
                <p className="muted dr-note">
                  Tu détiens ce titre en direct <em>et</em> à l'intérieur d'un ETF : ton exposition réelle dépasse
                  ce que suggère la liste des positions.
                </p>
              )}
            </section>
          )}

          <section className="dr-section">
            <div className="dr-ai-head">
              <h4>Avis IA {insight && <InsightBadge insight={insight} />}</h4>
              <button className="btn ghost" style={{ padding: '5px 11px', fontSize: 12.5 }} onClick={() => onAnalyze?.(p)}>
                {insight ? 'Réanalyser' : 'Analyser avec l\'IA'}
              </button>
            </div>
            {insight ? (
              <>
                <div className="dr-ai-grid">
                  {insight.risk_score != null && <Row label="Risque (0-10)">{insight.risk_score}</Row>}
                  {insight.recommendation && <Row label="Reco">{RECOMMENDATION_LABELS[insight.recommendation] || insight.recommendation}</Row>}
                  {insight.fair_value != null && (
                    <Row label="Valeur estimée">{fmtNum(insight.fair_value)} {insight.fair_value_ccy || ''}</Row>
                  )}
                  {insight.as_of && <Row label="Daté du">{fmtDate(insight.as_of)}</Row>}
                </div>
                {insight.summary && <p className="dr-ai-summary">{insight.summary}</p>}
                <Points title="Points positifs" items={insight.payload?.bull_points} />
                <Points title="Points de vigilance" items={insight.payload?.bear_points || insight.payload?.key_risks} />
                <p className="muted dr-note">Avis d'une IA généraliste, à partir de tes chiffres — pas un conseil en investissement.</p>
              </>
            ) : (
              <p className="muted dr-note">
                Pas encore d'analyse. Génère un prompt pré-rempli pour ce titre, colle-le dans un assistant, puis reviens coller sa réponse.
              </p>
            )}
          </section>

          <section className="dr-section">
            <h4>Pages finance</h4>
            <StockLinks stock={{ ticker: p.ticker, isin: p.isin, name: p.name }} />
          </section>

          {/* Des liens plutôt qu'un flux : les appels sortants du serveur sont
              filtrés chez l'hébergeur, et la liste d'articles restait vide sans
              jamais dire pourquoi. Le navigateur, lui, atteint la source. */}
          <section className="dr-section">
            <h4>Actualités</h4>
            <div className="stock-links">
              {newsLinks({ ticker: p.ticker, isin: p.isin, name: p.name }).map((l) => (
                <a key={l.label} className="chip link-chip" href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.label} ↗
                </a>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
