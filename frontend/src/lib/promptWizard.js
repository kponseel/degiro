import { fmtEur, fmtNum, fmtPct, fmtDate } from './format.js';
import { buildFormatInstructions, makeRef } from '../../../shared/aiInsightContract.js';

/**
 * Générateur de prompts, module PUR (aucune API navigateur) : c'est lui qui
 * assemble le texte à copier, et c'est la seule partie testable hors navigateur.
 *
 * Deux partis pris pour économiser des tokens sans nuire à la fiabilité :
 *  - le contexte du portefeuille est un TABLEAU compact (« ISIN|nom|poids »),
 *    pas des phrases : 2-3× moins de tokens en entrée, et mieux lu par l'IA ;
 *  - un mode « réponse courte » plafonne la prose (le vrai poids en sortie) ;
 *  - le bloc de données reste du JSON, le format que les modèles ratent le moins.
 */

const DISCLAIMER =
  "Distingue les faits des opinions, signale les incertitudes, et rappelle que ce n'est pas un conseil "
  + "en investissement personnalisé. Si tu as accès au web, utilise des données récentes et cite tes sources datées.";

const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}` : '');

/**
 * Contexte portefeuille en tableau serré. `top` limite le nombre de lignes
 * (une analyse ciblée n'a pas besoin des 27 positions), `withExpo` ajoute les
 * répartitions déjà agrégées.
 */
export function compactContext({ snapshot, positions }, exposure, { top = 0, withExpo = true } = {}) {
  const total = positions.reduce((s, p) => s + (Number(p.value_eur) || 0), 0) || 1;
  const sorted = [...positions].sort((a, b) => (Number(b.value_eur) || 0) - (Number(a.value_eur) || 0));
  const shown = top > 0 ? sorted.slice(0, top) : sorted;

  const lines = [
    `Portefeuille au ${fmtDate(snapshot.snapshot_date)} · investi ${fmtEur(total)} · liquidités ${fmtEur(snapshot.cash_eur)} · ${positions.length} lignes`,
    'ISIN|nom|poids%|cours|devise',
    ...shown.map((p) => [
      p.isin,
      (p.name || p.symbol || p.isin).replace(/\|/g, ' ').slice(0, 40),
      pct((Number(p.value_eur) || 0) / total),
      fmtNum(p.price),
      p.currency || '',
    ].join('|')),
  ];
  if (top > 0 && sorted.length > top) lines.push(`… (+${sorted.length - top} lignes plus petites omises)`);

  if (withExpo && exposure) {
    const row = (label, arr) => (arr?.length
      ? `${label}: ${arr.slice(0, 6).map((x) => `${x.key} ${pct(x.weight)}%`).join(' · ')}` : null);
    const rows = [
      row('Secteur', exposure.sector),
      row('Pays', exposure.country),
      row('Devise', exposure.currency),
    ].filter(Boolean);
    if (rows.length) lines.push('', ...rows);
  }
  return lines.join('\n');
}

/** Contexte d'un titre précis, en une ligne. */
function stockContext(p, weight) {
  const bits = [
    `Titre : ${p.name || p.symbol} (ISIN ${p.isin}${p.ticker ? `, ${p.ticker}` : ''})`,
    `${fmtNum(p.qty, 0)} × ${fmtNum(p.price)} ${p.currency || ''} = ${fmtEur(p.value_eur)}`,
    `poids ${fmtPct(weight)}`,
  ];
  if (p.sector) bits.push(`secteur ${p.sector}`);
  if (p.country) bits.push(`pays ${p.country}`);
  return bits.join(' · ');
}

// ── Objectifs et leurs étapes ────────────────────────────────────────
// Chaque étape : { id, label, optional?, options:[{value,label,default?}] }.
// Une étape optionnelle peut être « passée » (valeur = null).

const HORIZON = {
  id: 'horizon',
  label: 'Sur quel horizon veux-tu raisonner ?',
  options: [
    { value: 'court', label: 'Court terme (< 1 an)' },
    { value: 'moyen', label: 'Moyen terme (1-3 ans)', default: true },
    { value: 'long', label: 'Long terme (5 ans +)' },
  ],
};

const TONE = {
  id: 'tone',
  label: 'Quel ton préfères-tu ?',
  optional: true,
  options: [
    { value: 'equilibre', label: 'Équilibré', default: true },
    { value: 'prudent', label: 'Plutôt prudent' },
    { value: 'offensif', label: 'Plutôt offensif' },
  ],
};

const LENGTH = {
  id: 'length',
  label: "Longueur de l'analyse ?",
  options: [
    { value: 'court', label: 'Courte (5-8 lignes) — économise des tokens', default: true },
    { value: 'detaille', label: 'Détaillée' },
  ],
};

const CASH = {
  id: 'cash',
  label: 'De combien de liquidités disposes-tu ?',
  options: [
    { value: 'none', label: 'Aucune — tout est investi', default: true },
    { value: 'some', label: 'Un petit appoint' },
    { value: 'fresh', label: "Je peux ajouter de l'argent frais" },
  ],
};

const EXIT_REASON = {
  id: 'exitReason',
  label: 'Ton objectif ?',
  options: [
    { value: 'profit', label: 'Sécuriser mes gains au bon moment', default: true },
    { value: 'cash', label: "Récupérer une partie de mon argent" },
    { value: 'trim', label: 'Alléger ce qui est devenu trop cher' },
  ],
};

const cashText = {
  none: "Je n'ai plus de liquidités : chaque achat doit être financé par une vente (opération neutre en cash).",
  some: "J'ai un petit appoint de liquidités ; l'essentiel des achats doit rester financé par des ventes.",
  fresh: "Je peux ajouter de l'argent frais si une opportunité claire le justifie.",
};

const exitReasonText = {
  profit: 'Je veux sécuriser mes gains au bon moment, sans sortir trop tôt.',
  cash: "J'aurai besoin de récupérer une partie de mon argent : aide-moi à choisir quoi vendre, et quand.",
  trim: 'Je veux alléger les lignes devenues chères ou surpondérées.',
};

const horizonText = { court: 'à court terme (< 1 an)', moyen: 'à moyen terme (1-3 ans)', long: 'à long terme (5 ans et plus)' };
const toneText = { prudent: 'en priorisant la préservation du capital', offensif: 'avec un appétit pour le risque assumé', equilibre: '' };

export const GOALS = [
  {
    id: 'stock_full',
    scope: 'position',
    label: 'Analyser un titre',
    desc: 'Thèse haussière/baissière, valorisation, zones d’achat/vente, catalyseurs.',
    needsStock: true,
    steps: [HORIZON, TONE, LENGTH],
    body: ({ sel, weight, answers }) => `Tu es analyste actions${answers.tone && toneText[answers.tone] ? `, ${toneText[answers.tone]}` : ''}. Tu as accès à la recherche web pour des données récentes.

${stockContext(sel, weight)}

Analyse ce titre ${horizonText[answers.horizon] || ''} :
1. Thèse : arguments haussiers (bull) vs baissiers (bear).
2. Valorisation : multiples clés vs historique et concurrents.
3. Zones de prix : achat / renforcement / prise de profit, et un stop raisonnable — avec le raisonnement.
4. Catalyseurs et risques principaux, avec leurs échéances.
5. Conclusion : conserver / renforcer / alléger, sachant que cette ligne pèse ${fmtPct(weight)} chez moi.`,
  },
  {
    id: 'risk',
    scope: 'portfolio',
    label: 'Analyser les risques',
    desc: 'Concentrations, vulnérabilités, comportement en cas de choc de marché.',
    steps: [HORIZON, LENGTH],
    body: ({ pf, expo, answers }) => `Tu es analyste risques. Voici mon portefeuille (courtier DEGIRO, en EUR).

${compactContext(pf, expo)}

Évalue le risque ${horizonText[answers.horizon] || ''} :
1. Concentrations et vulnérabilités principales (ligne, secteur, pays, devise).
2. Comportement qualitatif dans 3 scénarios : correction tech -20 %, forte hausse des taux, récession avec dollar faible.
3. Ajustements simples qui réduiraient le risque sans dénaturer la stratégie.`,
  },
  {
    id: 'diversification',
    scope: 'portfolio',
    label: 'Diversification & change',
    desc: 'Déséquilibres secteur/pays/devise et exposition au dollar.',
    steps: [LENGTH],
    body: ({ pf, expo }) => `Tu es gérant de portefeuille. Voici mes expositions (portefeuille en EUR).

${compactContext(pf, expo)}

1. Déséquilibres d'exposition (secteur, pays, devise) et risques associés.
2. Exposition au dollar : impact d'une variation EUR/USD de ±10 %, faut-il couvrir ?
3. Une allocation cible raisonnable pour un particulier européen, et les mouvements concrets pour s'en rapprocher.`,
  },
  {
    id: 'dividends',
    scope: 'portfolio',
    label: 'Projection de dividendes',
    desc: 'Rendement attendu, solidité des versements, lignes à renforcer.',
    steps: [LENGTH],
    body: ({ pf, expo }) => `Tu es analyste revenus. Tu as accès au web pour les rendements récents. Voici mon portefeuille (EUR).

${compactContext(pf, expo)}

1. Estime le rendement sur dividende actuel de chaque ligne qui en verse, et le rendement global du portefeuille.
2. Solidité et croissance attendue de ces dividendes (payout, historique).
3. Quelles lignes renforcer pour améliorer le revenu sans trop dégrader la diversification ?`,
  },
  {
    id: 'rebalance',
    scope: 'portfolio',
    label: 'Rééquilibrer / optimiser',
    desc: 'Réallouer ce que tu détiens déjà — financer les achats par des ventes, avec ou sans argent frais.',
    steps: [CASH, HORIZON, TONE, LENGTH],
    body: ({ pf, expo, answers }) => `Tu es conseiller en allocation${answers.tone && toneText[answers.tone] ? `, ${toneText[answers.tone]}` : ''}. Voici mon portefeuille (DEGIRO, en EUR).

${compactContext(pf, expo)}

Contrainte de budget : ${cashText[answers.cash] || cashText.none}

Propose un plan d'optimisation ${horizonText[answers.horizon] || ''} :
1. Les positions à alléger ou solder en priorité (valorisation, risque, redondance) et pourquoi.
2. Où réinvestir le produit des ventes : renforcer l'existant ou ouvrir 1-2 lignes, en justifiant chaque choix.
3. Un plan chiffré et équilibré (les ventes financent les achats), avec l'ordre d'exécution.
4. Les pièges à éviter : fiscalité des plus-values, frais, market timing et sur-concentration.`,
  },
  {
    id: 'exit',
    scope: 'portfolio',
    label: 'Quand vendre / récupérer mon argent',
    desc: 'Prix de sortie, prise de profit, et le bon moment pour sécuriser ou récupérer ton capital.',
    steps: [EXIT_REASON, HORIZON, LENGTH],
    body: ({ pf, expo, answers }) => `Tu es analyste actions avec accès au web pour des données récentes. Voici mon portefeuille (EUR).

${compactContext(pf, expo)}

Objectif : ${exitReasonText[answers.exitReason] || exitReasonText.profit}
Horizon : ${horizonText[answers.horizon] || 'à préciser'}.

Pour mes principales lignes :
1. Une estimation de valeur « juste » et une zone de prix de sortie (prise de profit partielle puis totale), avec le raisonnement.
2. Les signaux qui justifieraient de vendre (valorisation tendue, thèse cassée, objectif atteint) plutôt que de conserver.
3. Si je dois libérer des liquidités : dans quel ordre vendre (quoi en premier et pourquoi), en tenant compte des plus-values latentes et de la fiscalité.
4. Un plan simple, daté, étape par étape.`,
  },
];

export const goalById = (id) => GOALS.find((g) => g.id === id) || null;

/** Valeur par défaut d'une étape (première marquée default, sinon la première). */
export const stepDefault = (step) => (step.options.find((o) => o.default) || step.options[0]).value;

/**
 * Assemble le prompt final.
 * @returns {{ text, scope, isin, ref, goal }}
 */
export function assemblePrompt({ goalId, answers = {}, pf, expo, sel = null, ref = makeRef() }) {
  const goal = goalById(goalId);
  if (!goal) throw new Error(`objectif inconnu : ${goalId}`);

  const total = pf.positions.reduce((s, p) => s + (Number(p.value_eur) || 0), 0) || 1;
  const weight = sel ? (Number(sel.value_eur) || 0) / total : 0;
  const isin = goal.scope === 'position' ? sel?.isin ?? null : null;

  const body = goal.body({ pf, expo, sel, weight, answers });
  const short = answers.length === 'court'
    ? '\n\nRéponds de façon concise : 5 à 8 lignes d\'analyse maximum avant le bloc de données.'
    : '';

  const text = `${body}

${DISCLAIMER}${short}
${buildFormatInstructions({ ref, scope: goal.scope, isin })}`;

  return { text, scope: goal.scope, isin, ref, goal: goal.id };
}
