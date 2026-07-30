import { Router } from 'express';
import { ingestSchema } from '../schemas/ingest.js';
import { ingestSnapshot } from '../services/ingest.js';
import { saveTransactions } from '../services/transactions.js';
import { classifyDescription } from '../services/csvParser.js';

const router = Router();

/**
 * Reclasse les MOUVEMENTS de trésorerie (sans quantité) d'après leur libellé.
 *
 * L'extension capture désormais le relevé de compte, mais n'embarque pas la
 * table de classification multilingue : elle envoie un type provisoire et le
 * serveur tranche, avec la même fonction que l'import Account.csv. Une seule
 * table, donc aucun risque de voir un dividende classé différemment selon la
 * voie d'entrée.
 *
 * Les ordres (quantité renseignée) ne sont pas touchés : leur sens vient du
 * signe de la quantité, pas d'un libellé.
 */
function reclasserMouvements(txs) {
  return txs.map((t) => (t.qty == null && t.description
    ? { ...t, type: classifyDescription(t.description) }
    : t));
}

// POST /api/ingest — reçoit, valide et stocke un snapshot (+ positions) et,
// optionnellement, l'historique des transactions (achats/ventes) capturé par
// l'extension. Le snapshot est déduit par capture_id ; les transactions sont
// idempotentes via external_id (upsert réparateur : la version la plus complète
// d'un ordre gagne, une valeur absente n'efface rien) — les renvoyer ne double rien.
router.post('/', async (req, res, next) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload invalide', details: parsed.error.flatten() });
  }
  try {
    const result = await ingestSnapshot(parsed.data, req.user.id);
    const transactions = parsed.data.transactions?.length
      ? await saveTransactions(reclasserMouvements(parsed.data.transactions), req.user.id)
      : undefined;
    return res.status(result.deduplicated ? 200 : 201).json({ ...result, transactions });
  } catch (err) {
    return next(err);
  }
});

export default router;
