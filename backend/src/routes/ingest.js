import { Router } from 'express';
import { ingestSchema } from '../schemas/ingest.js';
import { ingestSnapshot } from '../services/ingest.js';

const router = Router();

// POST /api/ingest — reçoit, valide et stocke un snapshot (+ positions).
router.post('/', async (req, res, next) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Payload invalide', details: parsed.error.flatten() });
  }
  try {
    const result = await ingestSnapshot(parsed.data, req.user.id);
    return res.status(result.deduplicated ? 200 : 201).json(result);
  } catch (err) {
    return next(err);
  }
});

export default router;
