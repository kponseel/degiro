import { RECOMMENDATION_LABELS } from '../../../shared/aiInsightContract.js';

/**
 * Mise en forme de l'avis IA « portefeuille » avant affichage.
 *
 * Le backend renvoie la ligne SQL telle quelle : les colonnes indexées
 * (risk_score, summary…) ET le bloc d'origine dans `payload`. Le payload fait
 * foi — c'est ce que l'assistant a écrit — mais un avis éclaté par le fan-out
 * peut n'avoir que les colonnes. D'où la lecture « payload d'abord, colonne
 * ensuite ».
 *
 * Isolé du composant pour être testable sans navigateur (voir backend/test/).
 */

/** Sévérité → ordre d'affichage : ce qui pique en premier, pas l'ordre du modèle. */
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

/** Sévérité → libellé + classe de pastille (les tons existent déjà en CSS). */
const SEVERITY_META = {
  high: { label: 'Élevé', tone: 'sev-high' },
  medium: { label: 'Moyen', tone: 'warn' },
  low: { label: 'Faible', tone: '' },
};

/**
 * Libellés des actions suggérées. Les quatre premières sont celles des
 * recommandations (même vocabulaire pour l'utilisateur) ; « watch » n'existe
 * que dans les avis portefeuille.
 */
export const ACTION_LABELS = { ...RECOMMENDATION_LABELS, watch: 'Surveiller' };

/** Assistant d'origine : la valeur stockée est un identifiant, pas un nom. */
const PROVIDER_LABELS = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', autre: 'un assistant' };

/**
 * @param {object|null} row  ligne renvoyée par GET /api/ai/insights (champ `portfolio`)
 * @returns {object|null} vue prête à afficher, ou null s'il n'y a rien à montrer
 */
export function portfolioInsightView(row) {
  if (!row || row.scope !== 'portfolio') return null;
  const p = row.payload || {};

  const warnings = (p.warnings || [])
    .filter((w) => w && w.label)
    .map((w) => {
      const meta = SEVERITY_META[w.severity] || SEVERITY_META.low;
      return {
        text: w.label,
        isin: w.isin || null,
        severity: w.severity || 'low',
        severityLabel: meta.label,
        tone: meta.tone,
      };
    })
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3));

  const actions = (p.suggested_actions || [])
    .filter((a) => a && a.action)
    .map((a) => ({
      action: a.action,
      label: ACTION_LABELS[a.action] || a.action,
      // Le ton reprend celui des badges : vert = renforcer, rouge = alléger.
      tone: a.action === 'buy' ? 'pos' : (a.action === 'sell' || a.action === 'reduce' ? 'neg' : ''),
      isin: a.isin || null,
      rationale: a.rationale || null,
    }));

  const summary = p.summary || row.summary || null;
  const risk = p.risk_score ?? (row.risk_score == null ? null : Number(row.risk_score));
  const diversification = p.diversification_score ?? null;

  // Une carte sans résumé, sans score et sans liste n'apprendrait rien : mieux
  // vaut ne rien afficher que d'ouvrir un bloc vide sur le tableau de bord.
  if (!summary && risk == null && diversification == null && !warnings.length && !actions.length) return null;

  return {
    id: row.id,
    summary,
    risk,
    diversification,
    warnings,
    actions,
    asOf: p.as_of || row.as_of || null,
    provider: PROVIDER_LABELS[row.provider] || null,
  };
}
