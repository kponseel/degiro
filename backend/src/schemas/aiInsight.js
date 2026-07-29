import { z } from 'zod';
import {
  SCHEMA_VERSION, RECOMMENDATIONS, CONFIDENCES, SEVERITIES, ACTIONS, LIMITS, REF_RE,
} from '../../../shared/aiInsightContract.js';

/**
 * Validation du bloc de données extrait d'une réponse d'IA collée.
 *
 * Philosophie : strict sur ce qui porte du sens (la référence, l'ISIN visé, un
 * score aberrant), tolérant sur tout le reste. L'utilisateur ne contrôle pas ce
 * que l'IA écrit — chaque refus évitable est une réponse à refaire :
 *  - une phrase trop longue est TRONQUÉE ;
 *  - une liste trop longue est TRONQUÉE (16 actions suggérées sur un
 *    portefeuille de 27 lignes est une réponse de qualité, pas une erreur) ;
 *  - un champ inconnu est IGNORÉ (les modèles adorent en ajouter) ;
 *  - « Conserver », « Hold » ou « élevée » sont COMPRIS (alias, casse) ;
 *  - un score « 7,5 » ou « 7/10 » est ARRONDI en entier ;
 *  - null vaut « non renseigné » partout où le champ est facultatif — le
 *    prompt dit précisément « mets null si tu ne peux pas remplir » ;
 *  - un élément de liste individuellement inexploitable (ticker au lieu
 *    d'ISIN…) est ÉCARTÉ sans condamner le bloc entier.
 */

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

// ── Tolérances élémentaires ──────────────────────────────────────────

/** Champ facultatif : null et undefined valent tous deux « non renseigné ». */
const opt = (schema) => z.preprocess((v) => (v == null ? undefined : v), schema.optional());

/** Ce que les modèles écrivent vraiment, ramené aux valeurs du contrat. */
const ALIASES = {
  'achat fort': 'strong_buy',
  acheter: 'buy', achat: 'buy', renforcer: 'buy',
  conserver: 'hold', garder: 'hold', neutre: 'hold',
  'alléger': 'reduce', alleger: 'reduce', 'réduire': 'reduce', reduire: 'reduce',
  vendre: 'sell', vente: 'sell',
  surveiller: 'watch',
  faible: 'low', bas: 'low', basse: 'low',
  moyen: 'medium', moyenne: 'medium', 'modéré': 'medium', modere: 'medium', 'modérée': 'medium',
  'élevé': 'high', 'élevée': 'high', eleve: 'high', elevee: 'high',
  haut: 'high', haute: 'high', fort: 'high', forte: 'high',
};

/** Énumération indulgente : casse, espaces/tirets, synonymes français. */
const looseEnum = (values) => z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, ' ');
  if (ALIASES[s]) return ALIASES[s];
  const snake = s.replace(/ /g, '_');
  return values.includes(snake) ? snake : v;
}, z.enum(values));

const clip = (max) => z.string().transform((s) => s.trim().slice(0, max));

/** Score : « 7 », 7.5, « 7,5 » ou « 7/10 » → entier. 11 reste refusé (aberrant). */
const score = z.preprocess((v) => {
  let n = v;
  if (typeof n === 'string') {
    const m = n.match(/-?\d+(?:[.,]\d+)?/);
    if (m) n = Number(m[0].replace(',', '.'));
  }
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : v;
}, z.number().int().min(LIMITS.score.min).max(LIMITS.score.max));

const isin = z.string().trim().toUpperCase().regex(ISIN_RE, 'ISIN invalide');

/** ISIN facultatif : une valeur invalide (ticker, nom) devient null, pas un refus. */
const isinOrNull = z.preprocess((v) => {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return ISIN_RE.test(s) ? s : null;
}, z.string().nullable());

/** Date AAAA-MM-JJ pêchée dans la valeur ; introuvable → null (pré-remplie dans le prompt). */
const asOf = z.preprocess((v) => {
  const m = typeof v === 'string' ? v.match(/\d{4}-\d{2}-\d{2}/) : null;
  return m ? m[0] : null;
}, z.string().nullable());

/** Juste prix : exploitable seulement avec montant ET devise ; sinon null. */
const fairValue = z.preprocess((v) => {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return null;
  const amount = typeof v.amount === 'string' ? Number(v.amount.replace(',', '.')) : v.amount;
  const currency = typeof v.currency === 'string' ? v.currency.trim().toUpperCase() : '';
  if (typeof amount === 'number' && Number.isFinite(amount) && /^[A-Z]{3}$/.test(currency)) {
    return { amount, currency };
  }
  return null;
}, z.object({ amount: z.number().finite(), currency: z.string().length(3) }).nullable());

/**
 * Liste indulgente : tronquée à `max` au lieu d'être refusée, et chaque élément
 * individuellement invalide est écarté plutôt que de condamner le bloc entier.
 */
const salvageArray = (item, max) => opt(z.preprocess(
  (v) => (Array.isArray(v)
    ? v.filter((x) => item.safeParse(x).success).slice(0, max)
    : v),
  z.array(item).max(max),
));

/** Liste de phrases : éléments non-texte écartés, tronquée, phrases coupées. */
const pointList = opt(z.preprocess(
  (v) => (Array.isArray(v)
    ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, LIMITS.listItems)
    : v),
  z.array(clip(LIMITS.point)),
));

// ── Schémas ──────────────────────────────────────────────────────────
// (pas de .strict() : un champ inconnu est ignoré, pas refusé)

const common = {
  schema_version: z.preprocess((v) => Number(v), z.literal(SCHEMA_VERSION)),
  ref: z.string().trim().regex(REF_RE),
  as_of: asOf,
  confidence: opt(looseEnum(CONFIDENCES)),
  summary: opt(clip(LIMITS.summary)),
};

export const positionInsightSchema = z.object({
  ...common,
  scope: z.literal('position'),
  isin,
  risk_score: score,
  quality_score: opt(score),
  recommendation: looseEnum(RECOMMENDATIONS),
  fair_value: opt(fairValue),
  horizon_months: opt(z.preprocess(
    (v) => (typeof v === 'string' ? Number(v) : v),
    z.number().int().min(LIMITS.horizonMonths.min).max(LIMITS.horizonMonths.max),
  )),
  bull_points: pointList,
  bear_points: pointList,
  key_risks: pointList,
  catalysts: salvageArray(
    z.object({ label: clip(LIMITS.label), when: opt(clip(20)) }),
    LIMITS.listItems,
  ),
  dividend_safety: opt(score),
});

export const portfolioInsightSchema = z.object({
  ...common,
  scope: z.literal('portfolio'),
  risk_score: score,
  diversification_score: opt(score),
  // Alertes et actions : autant que de lignes possibles — une IA généreuse qui
  // conseille 16 mouvements sur 27 lignes livre exactement ce qu'on lui demande.
  warnings: salvageArray(
    z.object({ severity: looseEnum(SEVERITIES), label: clip(LIMITS.label), isin: opt(isinOrNull) }),
    LIMITS.positionsFanout,
  ),
  suggested_actions: salvageArray(
    z.object({ action: looseEnum(ACTIONS), isin: opt(isinOrNull), rationale: opt(clip(LIMITS.rationale)) }),
    LIMITS.positionsFanout,
  ),
  positions: salvageArray(
    z.object({
      isin,
      risk_score: opt(score),
      recommendation: opt(looseEnum(RECOMMENDATIONS)),
      note: opt(clip(LIMITS.point)),
    }),
    LIMITS.positionsFanout,
  ),
});

export const insightSchema = z.discriminatedUnion('scope', [positionInsightSchema, portfolioInsightSchema]);
