import { Router } from 'express';
import { ingestSchema } from '../schemas/ingest.js';
import { ingestSnapshot } from '../services/ingest.js';
import { saveTransactions } from '../services/transactions.js';

const router = Router();

// POST /api/ingest — reçoit, valide et stocke un snapshot (+ positions) et,
// optionnellement, l'historique des transactions (achats/ventes) capturé par
// l'extension. Le snapshot est déduit par capture_id ; les transactions sont
// idempotentes via external_id (INSERT IGNORE) — les renvoyer ne double rien.
router.post('/', async (req, res, next) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload invalide', details: parsed.error.flatten() });
  }
  try {
    const result = await ingestSnapshot(parsed.data, req.user.id);
    const transactions = parsed.data.transactions?.length
      ? await saveTransactions(parsed.data.transactions, req.user.id)
      : undefined;
    return res.status(result.deduplicated ? 200 : 201).json({ ...result, transactions });
  } catch (err) {
    return next(err);
  }
});

export default router;
