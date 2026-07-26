/**
 * Contrat du « bloc de données » que l'assistant IA doit joindre à sa réponse.
 *
 * Ce module est la source de vérité UNIQUE du format : le frontend l'importe
 * pour écrire les instructions dans le prompt, le backend pour valider ce que
 * l'utilisateur colle. S'ils divergeaient, les prompts exigeraient une forme
 * que le serveur refuse — le pire bug possible pour cette boucle.
 *
 * Il reste volontairement pur (pas de zod, pas d'API navigateur) : le schéma
 * de validation est construit côté backend à partir de ces constantes.
 *
 * Côté utilisateur, rien de tout ça n'est visible : il copie un prompt, colle
 * la réponse entière de l'assistant, et l'app retrouve le bloc toute seule.
 */

export const SCHEMA_VERSION = 1;

export const SCOPES = ['position', 'portfolio'];
export const RECOMMENDATIONS = ['strong_buy', 'buy', 'hold', 'reduce', 'sell'];
export const CONFIDENCES = ['low', 'medium', 'high'];
export const SEVERITIES = ['low', 'medium', 'high'];
export const ACTIONS = ['buy', 'hold', 'reduce', 'sell', 'watch'];

export const LIMITS = {
  score: { min: 0, max: 10 },            // entiers
  horizonMonths: { min: 1, max: 120 },
  listItems: 5,                           // taille max des tableaux de texte
  positionsFanout: 60,                    // avis par ligne dans un bloc portefeuille
  point: 200,                             // longueur max d'un point bull/bear/risque
  label: 120,
  rationale: 200,
  summary: 500,
  rawPaste: 200_000,                      // taille max du texte collé
};

/** Forme d'une référence de prompt : « p_ » + 8 alphanumériques. */
export const REF_RE = /^p_[a-z0-9]{8}$/;

export const makeRef = () =>
  `p_${Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')}`;

/** Libellés français des recommandations (affichage badges). */
export const RECOMMENDATION_LABELS = {
  strong_buy: 'Achat fort',
  buy: 'Achat',
  hold: 'Conserver',
  reduce: 'Alléger',
  sell: 'Vendre',
};

/**
 * Instructions à insérer À LA FIN d'un prompt. On ne demande pas « du JSON et
 * rien d'autre » : la réponse resterait illisible pour l'utilisateur, qui doit
 * pouvoir la lire dans ChatGPT avant de la coller ici. On demande une réponse
 * normale, TERMINÉE par le bloc — et le squelette est pré-rempli (ref, isin,
 * version) pour que le modèle n'ait plus qu'à compléter.
 */
export function buildFormatInstructions({ ref, scope, isin = null }) {
  const skeleton = scope === 'position'
    ? `{
  "schema_version": ${SCHEMA_VERSION},
  "ref": "${ref}",
  "scope": "position",
  "isin": "${isin}",
  "as_of": "AAAA-MM-JJ",
  "risk_score": 0-10,
  "quality_score": 0-10,
  "recommendation": "${RECOMMENDATIONS.join(' | ')}",
  "confidence": "${CONFIDENCES.join(' | ')}",
  "fair_value": { "amount": nombre, "currency": "USD" } ou null,
  "horizon_months": 12,
  "bull_points": ["1 à ${LIMITS.listItems} points, ${LIMITS.point} caractères max chacun"],
  "bear_points": ["…"],
  "key_risks": ["…"],
  "catalysts": [{ "label": "…", "when": "2026-Q4" }],
  "dividend_safety": 0-10 ou null,
  "summary": "synthèse en ${LIMITS.summary} caractères max"
}`
    : `{
  "schema_version": ${SCHEMA_VERSION},
  "ref": "${ref}",
  "scope": "portfolio",
  "as_of": "AAAA-MM-JJ",
  "risk_score": 0-10,
  "diversification_score": 0-10,
  "confidence": "${CONFIDENCES.join(' | ')}",
  "warnings": [{ "severity": "${SEVERITIES.join(' | ')}", "label": "…", "isin": "ISIN ou null" }],
  "suggested_actions": [{ "action": "${ACTIONS.join(' | ')}", "isin": "ISIN ou null", "rationale": "…" }],
  "positions": [{ "isin": "…", "risk_score": 0-10, "recommendation": "hold", "note": "…" }],
  "summary": "synthèse en ${LIMITS.summary} caractères max"
}`;

  return `
── FORMAT DE FIN DE RÉPONSE (obligatoire) ──
Rédige ton analyse normalement, puis TERMINE ta réponse par un bloc de données
entre \`\`\`json et \`\`\`, en complétant exactement ce squelette (ne change ni
"ref", ni "scope", ni "isin", ni "schema_version") :

\`\`\`json
${skeleton}
\`\`\`

Règles : nombres sans guillemets, scores entiers de 0 à 10 (10 = maximum),
valeurs de listes fermées reprises telles quelles, aucun champ ajouté.
Ce bloc permet à mon outil de suivi d'enregistrer ton analyse.`;
}
