/**
 * Contrat du « bloc de données » que l'assistant IA doit renvoyer.
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
 * la réponse de l'assistant, et l'app retrouve le bloc toute seule.
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
  listItems: 5,                           // taille max des listes de points (tronquées au-delà)
  positionsFanout: 60,                    // avis par ligne, alertes et actions d'un bloc portefeuille
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
 * Instructions de format à insérer À LA FIN d'un prompt.
 *
 * Parti pris : la réponse de l'assistant est LE bloc JSON, rien d'autre.
 * L'ancienne consigne (« analyse libre, puis bloc à la fin ») laissait chaque
 * modèle improviser — et l'improvisation ratait le format une fois sur deux.
 * Toute l'analyse tient désormais dans les champs du bloc, que l'app sait
 * afficher ; et le squelette est un EXEMPLE VALIDE que le modèle édite, pas un
 * pseudo-format (« 0-10 », « a | b ») qu'il recopiait littéralement.
 *
 * `today` (AAAA-MM-JJ) pré-remplit `as_of` : un champ pré-rempli de plus est
 * un champ que le modèle ne peut plus rater.
 */
export function buildFormatInstructions({ ref, scope, isin = null, today = null }) {
  const asOf = today || 'AAAA-MM-JJ';
  const skeleton = scope === 'position'
    ? `{
  "schema_version": ${SCHEMA_VERSION},
  "ref": "${ref}",
  "scope": "position",
  "isin": "${isin}",
  "as_of": "${asOf}",
  "risk_score": 6,
  "quality_score": 7,
  "recommendation": "hold",
  "confidence": "medium",
  "fair_value": { "amount": 123.5, "currency": "USD" },
  "horizon_months": 12,
  "bull_points": ["Premier argument haussier, développé en une phrase", "Deuxième argument"],
  "bear_points": ["Premier argument baissier"],
  "key_risks": ["Risque principal et son déclencheur"],
  "catalysts": [{ "label": "Prochains résultats trimestriels", "when": "2026-11" }],
  "dividend_safety": 5,
  "summary": "Ta conclusion d'analyste en quelques phrases : thèse, valorisation, ce que tu ferais et pourquoi."
}`
    : `{
  "schema_version": ${SCHEMA_VERSION},
  "ref": "${ref}",
  "scope": "portfolio",
  "as_of": "${asOf}",
  "risk_score": 6,
  "diversification_score": 5,
  "confidence": "medium",
  "warnings": [
    { "severity": "high", "label": "Le point de vigilance, décrit en une phrase", "isin": null }
  ],
  "suggested_actions": [
    { "action": "reduce", "isin": "US0000000000", "rationale": "Pourquoi, en une phrase" }
  ],
  "positions": [
    { "isin": "US0000000000", "risk_score": 6, "recommendation": "hold", "note": "Ton avis sur cette ligne, en une phrase" }
  ],
  "summary": "Ta conclusion d'ensemble en quelques phrases : diagnostic, priorités, ordre des mouvements."
}`;

  const perScope = scope === 'position'
    ? `- "recommendation" : exactement une valeur parmi ${RECOMMENDATIONS.join(', ')}.
- "fair_value" : ton estimation de juste prix, ou null si tu n'en as pas. "horizon_months" : un entier de ${LIMITS.horizonMonths.min} à ${LIMITS.horizonMonths.max}.
- "bull_points", "bear_points", "key_risks" : ${LIMITS.listItems} points maximum chacun, une phrase par point.`
    : `- "warnings" : tes alertes ("severity" : ${SEVERITIES.join(', ')}).
- "suggested_actions" : une entrée par mouvement conseillé ("action" : ${ACTIONS.join(', ')}).
- "positions" : une entrée par ligne listée dans mes données, avec son ISIN repris tel quel.`;

  return `
── FORMAT DE RÉPONSE (obligatoire) : un seul bloc JSON ──
Réponds UNIQUEMENT par un bloc \`\`\`json … \`\`\`. Aucun texte avant, aucun texte
après : toute ton analyse tient DANS les champs du bloc. Complète ce squelette
(c'est un exemple valide — remplace les valeurs par les tiennes) :

\`\`\`json
${skeleton}
\`\`\`

Comment le remplir :
- Ne modifie jamais "schema_version", "ref", "scope"${scope === 'position' ? ', "isin"' : ''} ni "as_of" : ils sont déjà remplis.
- Les scores ("risk_score", etc.) : UN entier de ${LIMITS.score.min} à ${LIMITS.score.max} (10 = maximum). Pas de fourchette, pas de guillemets.
- "confidence" : ${CONFIDENCES.join(', ')}.
${perScope}
- "isin" : toujours l'ISIN exact à 12 caractères repris de mes données, ou null — jamais un ticker.
- Un champ que tu ne peux pas remplir : mets null, ou omets-le.
- JSON strict : guillemets doubles, pas de commentaire, pas de virgule finale, nombres sans guillemets, aucun champ ajouté.
Ce bloc permet à mon outil de suivi d'enregistrer ton analyse — s'il est mal formé, elle est perdue.`;
}
