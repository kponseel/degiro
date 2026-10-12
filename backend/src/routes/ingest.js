import { Router } from 'express';
import { ingestSchema } from '../schemas/ingest.js';
import { ingestSnapshot } from '../services/ingest.js';

const router = Router();

// POST /api/ingest — reçoit, valide et stocke un instantané du portefeuille
// (positions + liquidités). L'instantané est dédoublonné par capture_id.
//
// Les transactions ne sont plus conservées : l'application n'analyse plus que le
// portefeuille ouvert. Une extension antérieure à la 0.6 en envoie encore — elles
// restent ACCEPTÉES par le schéma et simplement ignorées, pour que la capture
// réussisse au lieu d'échouer sur un champ devenu inutile.
router.post('/', async (req, res, next) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload invalide', details: parsed.error.flatten() });
  }
  try {
    const result = await ingestSnapshot(parsed.data, req.user.id);
    // Capture jugée incomplète : rien n'est enregistré ni remplacé. L'extension
    // explique et propose de renvoyer avec `force`.
    if (result.suspect) {
      return res.status(409).json({
        error: 'Capture suspecte : bien moins de lignes et de valeur que la précédente. Rien n\'a été remplacé.',
        suspect: result.suspect,
      });
    }
    return res.status(result.deduplicated ? 200 : 201).json(result);
  } catch (err) {
    return next(err);
  }
});

export default router;
