import { useEffect, useRef, useState } from 'react';
import { ingestAiInsight } from '../lib/api.js';
import { RECOMMENDATION_LABELS } from '../../../shared/aiInsightContract.js';

/**
 * Modal « Coller la réponse de l'assistant ».
 *
 * Cœur de la boucle côté grand public : l'utilisateur colle la réponse ENTIÈRE
 * de son IA (analyse lisible + bloc de données), l'app extrait le bloc. Aucun
 * JSON ni fichier à manipuler. En cas d'échec, le message est en clair et dit
 * quoi faire — jamais de jargon technique.
 *
 * @param onClose     ferme la modal
 * @param onIngested  appelé après un enregistrement réussi (rafraîchit les vues)
 */
const PROVIDERS = [
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'claude', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'autre', label: 'Autre' },
];

export default function InsightPasteModal({ onClose, onIngested }) {
  const [raw, setRaw] = useState('');
  const [provider, setProvider] = useState('chatgpt');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const panelRef = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => {
    previousFocus.current = document.activeElement;
    const panel = panelRef.current;
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = panel?.querySelectorAll('a[href], button, textarea, select, input, [tabindex]:not([tabindex="-1"])');
      if (!f?.length) return;
      const [first, last] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => panel?.querySelector('textarea')?.focus(), 40);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); previousFocus.current?.focus?.(); };
  }, [onClose]);

  async function paste() {
    try { setRaw(await navigator.clipboard.readText()); setError(null); }
    catch { setError('Le presse-papiers est bloqué par le navigateur — colle le texte à la main (Ctrl/⌘ + V) dans la zone.'); }
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = await ingestAiInsight(raw, provider);
      setDone(res.insight);
      onIngested?.(res);
    } catch (e) {
      setError(e.body?.error || e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="palette-scrim tour-scrim" role="presentation">
      <div className="tour paste-modal" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="paste-title">
        <div className="tour-head">
          <div>
            <span className="brand-mark">Récupérer l'analyse</span>
            <h2 id="paste-title">Colle la réponse de l'assistant</h2>
          </div>
          <button className="link-btn" onClick={onClose}>Fermer</button>
        </div>

        {done ? (
          <div className="tour-body">
            <div className="banner info" style={{ display: 'block' }}>
              <strong>Analyse enregistrée ✓</strong>
              <div style={{ marginTop: 6, fontSize: 13.5 }}>
                {done.scope === 'portfolio'
                  ? "L'avis sur l'ensemble du portefeuille est pris en compte."
                  : `L'avis sur ${done.isin} apparaîtra sur sa fiche.`}
              </div>
            </div>
            <button className="btn" style={{ marginTop: 14 }} onClick={onClose}>Terminé</button>
          </div>
        ) : (
          <div className="tour-body">
            <p className="muted" style={{ marginTop: 0 }}>
              Dans ChatGPT (ou l'assistant que tu as utilisé), <strong>sélectionne toute la réponse</strong>,
              copie-la, puis colle-la ici. Pas besoin de trier quoi que ce soit — l'app trouve le résumé toute seule.
            </p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
              <label className="muted" style={{ fontSize: 13 }} htmlFor="prov">Assistant :</label>
              <select id="prov" className="input" style={{ maxWidth: 160 }} value={provider} onChange={(e) => setProvider(e.target.value)}>
                {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={paste}>Coller depuis le presse-papiers</button>
            </div>

            <textarea
              className="input paste-area"
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setError(null); }}
              placeholder="Colle ici la réponse complète de l'assistant…"
              aria-label="Réponse de l'assistant"
            />

            {error && <div style={{ marginTop: 10 }} className="banner err">{error}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn" disabled={busy || !raw.trim()} onClick={submit}>
                {busy ? 'Lecture…' : 'Enregistrer l\'analyse'}
              </button>
              <button className="btn ghost" onClick={onClose}>Annuler</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Petite pastille réutilisable (tableau + drawer en PR C). Exportée ici pour éviter un fichier de plus. */
export function InsightBadge({ insight, compact = false }) {
  if (!insight) return null;
  const risk = insight.risk_score;
  const rec = insight.recommendation;
  const tone = rec === 'sell' || rec === 'reduce' ? 'neg' : (rec === 'buy' || rec === 'strong_buy' ? 'pos' : '');
  return (
    <span className={`insight-badge ${tone}`} title={insight.summary || ''}>
      {risk != null && <span className="ib-risk">R{risk}</span>}
      {rec && <span className="ib-rec">{compact ? (RECOMMENDATION_LABELS[rec] || rec).slice(0, 4) : RECOMMENDATION_LABELS[rec] || rec}</span>}
    </span>
  );
}
