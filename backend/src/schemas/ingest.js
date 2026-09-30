import { z } from 'zod';

// Bornes alignées sur les colonnes DECIMAL(18,x) : au-delà, MySQL tronquait
// silencieusement (INSERT IGNORE) ou levait une erreur ressortant en 500.
const money = z.number().finite().min(-1e14).max(1e14);
const quantity = z.number().finite().min(-1e12).max(1e12);

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
  pl_realized_eur: money.optional(),
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
  // Envoyé par les extensions antérieures à la 0.6, et ignoré : l'application
  // n'analyse plus que le portefeuille ouvert. Accepté sans validation pour
  // qu'un ordre mal formé dans un historique inutile ne fasse pas échouer la
  // capture des positions — puis retiré du résultat.
  transactions: z.unknown().optional().transform(() => undefined),
});
