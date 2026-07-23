import { z } from 'zod';

const position = z.object({
  isin: z.string().length(12),
  symbol: z.string().max(20).optional(),
  name: z.string().max(255).optional(),
  product_type: z.string().max(20).optional(),
  qty: z.number().optional(),
  price: z.number().optional(),
  currency: z.string().length(3).optional(),
  fx_rate: z.number().optional(),
  break_even_price: z.number().optional(),
  value_eur: z.number().optional(),
  pl_eur: z.number().optional(),
  pl_day_eur: z.number().optional(),
});

export const ingestSchema = z.object({
  schema_version: z.number().int().positive().default(1),
  source: z.enum(['extension', 'csv']),
  capture_id: z.string().min(1).max(36),
  captured_at: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'date invalide (attendu ISO 8601)' }),
  total_value_eur: z.number().optional(),
  cash_eur: z.number().optional(),
  raw_json: z.unknown().optional(),
  positions: z.array(position).default([]),
});
