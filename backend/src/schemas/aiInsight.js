import { z } from 'zod';
import {
  SCHEMA_VERSION, RECOMMENDATIONS, CONFIDENCES, SEVERITIES, ACTIONS, LIMITS, REF_RE,
} from '../../../shared/aiInsightContract.js';

/**
 * Validation du bloc de données extrait d'une réponse d'IA collée.
 *
 * Philosophie : strict sur ce qui porte du sens (scores, énumérations, ISIN),
 * tolérant sur ce qui n'en porte pas (une phrase trop longue est TRONQUÉE, pas
 * refusée). L'utilisateur ne contrôle pas ce que l'IA écrit — le renvoyer
 * regénérer une réponse pour trois caractères de trop serait de la cruauté.
 */

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

const clip = (max) => z.string().transform((s) => s.trim().slice(0, max));
const clippedList = (max) => z.array(clip(max)).max(LIMITS.listItems).optional();

const score = z.number().int().min(LIMITS.score.min).max(LIMITS.score.max);
const isin = z.string().trim().toUpperCase().regex(ISIN_RE, 'ISIN invalide');

// Date au format AAAA-MM-JJ ; l'IA met parfois l'heure, on la coupe.
const asOf = z.string().transform((s) => s.slice(0, 10))
  .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), 'date attendue au format AAAA-MM-JJ');

const common = {
  schema_version: z.literal(SCHEMA_VERSION),
  ref: z.string().regex(REF_RE),
  as_of: asOf,
  confidence: z.enum(CONFIDENCES).optional(),
  summary: clip(LIMITS.summary).optional(),
};

export const positionInsightSchema = z.object({
  ...common,
  scope: z.literal('position'),
  isin,
  risk_score: score,
  quality_score: score.optional(),
  recommendation: z.enum(RECOMMENDATIONS),
  fair_value: z.object({ amount: z.number().finite(), currency: z.string().trim().toUpperCase().length(3) }).nullish(),
  horizon_months: z.number().int().min(LIMITS.horizonMonths.min).max(LIMITS.horizonMonths.max).optional(),
  bull_points: clippedList(LIMITS.point),
  bear_points: clippedList(LIMITS.point),
  key_risks: clippedList(LIMITS.point),
  catalysts: z.array(z.object({ label: clip(LIMITS.label), when: clip(20).optional() })).max(LIMITS.listItems).optional(),
  dividend_safety: score.nullish(),
}).strict();

export const portfolioInsightSchema = z.object({
  ...common,
  scope: z.literal('portfolio'),
  risk_score: score,
  diversification_score: score.optional(),
  warnings: z.array(z.object({
    severity: z.enum(SEVERITIES),
    label: clip(LIMITS.label),
    isin: isin.nullish(),
  })).max(LIMITS.listItems * 2).optional(),
  suggested_actions: z.array(z.object({
    action: z.enum(ACTIONS),
    isin: isin.nullish(),
    rationale: clip(LIMITS.rationale).optional(),
  })).max(LIMITS.listItems * 2).optional(),
  positions: z.array(z.object({
    isin,
    risk_score: score.optional(),
    recommendation: z.enum(RECOMMENDATIONS).optional(),
    note: clip(LIMITS.point).optional(),
  })).max(LIMITS.positionsFanout).optional(),
}).strict();

export const insightSchema = z.discriminatedUnion('scope', [positionInsightSchema, portfolioInsightSchema]);
