import { useState } from 'react';
import { deleteAiInsight } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { portfolioInsightView } from '../lib/aiPortfolioView.js';
import { Card } from './ui.jsx';

/**
 * Carte « Avis IA du portefeuille » sur la Vue d'ensemble.
 *
 * Cinq des six objectifs du générateur de prompts portent sur l'ENSEMBLE du
 * portefeuille : sans cette carte, l'utilisateur colle la réponse de son
 * assistant, lit « Analyse enregistrée ✓ »… et ne voit jamais le résumé, les
 * scores, les avertissements ni les actions suggérées. Seules les notes par
 * titre (issues du fan-out) étaient rendues.
 *
 * @param insight    ligne `portfolio` de GET /api/ai/insights (ou null)
 * @param positions  positions courantes, pour nommer un ISIN cité par l'IA
 * @param onSelect   ouvre le panneau de détail d'une position
 * @param onDeleted  rafraîchit la vue après suppression
 */
export default function PortfolioInsightCard({ insight, positions = [], onSelect, onDeleted }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const view = portfolioInsightView(insight);
  if (!view) return null;

  /**
   * Un ISIN brut ne dit rien à personne : on affiche le titre concerné, et on
   * le rend cliquable (le panneau de détail est à un clic de l'avertissement).
   * Une fonction, et non un composant local : recréé à chaque rendu, il ferait
   * remonter le bouton et perdre le focus au clavier.
   */
  function positionRef(isin) {
    if (!isin) return null;
    const p = positions.find((x) => x.isin === isin);
    if (!p) return <> · <span className="muted">{isin}</span></>;
    return (
      <> · <button className="link-btn pf-ai-ref" onClick={() => onSelect?.(p)}>
        {p.symbol || p.ticker || p.name || isin}
      </button></>
    );
  }

  async function remove() {
    setBusy(true);
    try { await deleteAiInsight(view.id); onDeleted?.(); }
    finally { setBusy(false); setConfirm(false); }
  }

  return (
    <Card title="Avis IA du portefeuille" className="pf-ai">
      <div className="pf-ai-top">
        <div className="pf-ai-scores">
          {view.risk != null && (
            <div className="dr-kpi">
              <span className="dr-kpi-label">Risque</span>
              <span className="dr-kpi-value">{view.risk}<span className="muted"> / 10</span></span>
            </div>
          )}
          {view.diversification != null && (
            <div className="dr-kpi">
              <span className="dr-kpi-label">Diversification</span>
              <span className="dr-kpi-value">{view.diversification}<span className="muted"> / 10</span></span>
            </div>
          )}
        </div>
        {confirm
          ? (
            <button className="btn danger" style={{ padding: '5px 11px', fontSize: 12.5 }} disabled={busy} onClick={remove}>
              Confirmer la suppression
            </button>
          )
          : <button className="link-btn danger-text" onClick={() => setConfirm(true)}>Supprimer cet avis</button>}
      </div>

      {view.summary && <p className="dr-ai-summary">{view.summary}</p>}

      <div className="pf-ai-cols">
        {view.warnings.length > 0 && (
          <div className="dr-ai-points">
            <span className="dr-ai-points-t">Points d'attention</span>
            <ul className="pf-ai-list">
              {view.warnings.map((w, i) => (
                <li key={i}>
                  <span className={`chip ${w.tone}`}>{w.severityLabel}</span>
                  <span className="pf-ai-txt">{w.text}{positionRef(w.isin)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {view.actions.length > 0 && (
          <div className="dr-ai-points">
            <span className="dr-ai-points-t">Actions suggérées</span>
            <ul className="pf-ai-list">
              {view.actions.map((a, i) => (
                <li key={i}>
                  <span className={`chip ${a.tone}`}>{a.label}</span>
                  <span className="pf-ai-txt">{a.rationale}{positionRef(a.isin)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="muted dr-note">
        {view.asOf ? `Analyse datée du ${fmtDate(view.asOf)}` : 'Analyse'}
        {view.provider ? ` par ${view.provider}` : ''} — avis d'une IA généraliste à partir de tes chiffres,
        pas un conseil en investissement.
      </p>
    </Card>
  );
}
