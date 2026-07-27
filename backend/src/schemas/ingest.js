import { z } from 'zod';

// Bornes alignées sur les colonnes DECIMAL(18,x) : au-delà, MySQL tronquait
// silencieusement (INSERT IGNORE) ou levait une erreur ressortant en 500.
const money = z.number().finite().min(-1e14).max(1e14);
const quantity = z.number().finite().min(-1e12).max(1e12);

/** Date acceptée par la colonne DATETIME, et réellement analysable. */
const sqlDate = z.string().refine(
  (s) => /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(s) && !Number.isNaN(Date.parse(s.replace(' ', 'T'))),
  { message: 'date invalide (attendu AAAA-MM-JJ [HH:MM:SS])' },
);

const position = z.object({
  isin: z.string().length(12),
  symbol: z.string().max(20).optional(),
  name: z.string().max(255).optional(),
  product_type: z.string().max(20).optional(),
  qty: quantity.optional(),
  price: money.optional(),
  currency: z.string().length(3).optional(),
  fx_rate: z.number().finite().optional(),
  break_even_price: money.optional(),
  value_eur: money.optional(),
  pl_eur: money.optional(),
  pl_day_eur: money.optional(),
});

// Ordres et mouvements — mêmes types que la table `transactions`. L'extension
// n'envoie aujourd'hui que des 'buy'/'sell', mais le contrat accepte l'ensemble
// pour couvrir une future capture du relevé de compte (dividendes, taxes…).
const transaction = z.object({
  tx_date: sqlDate,
  type: z.enum([
    'deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'tax',
    'transaction_tax', 'fee', 'fx', 'split', 'isin_change', 'other',
  ]),
  isin: z.string().length(12).nullable().optional(),
  description: z.string().max(255).nullable().optional(),
  qty: quantity.nullable().optional(),
  amount: money.nullable().optional(),
  currency: z.string().max(3).nullable().optional(),
  amount_eur: money.nullable().optional(),
  external_id: z.string().min(1).max(64),
});

export const ingestSchema = z.object({
  schema_version: z.number().int().positive().default(1),
  source: z.enum(['extension', 'csv']),
  capture_id: z.string().min(1).max(36),
  captured_at: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'date invalide (attendu ISO 8601)' }),
  total_value_eur: money.optional(),
  cash_eur: money.optional(),
  raw_json: z.unknown().optional(),
  positions: z.array(position).default([]),
  transactions: z.array(transaction).default([]),
});
