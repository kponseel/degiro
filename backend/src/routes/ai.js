import { Router } from 'express';
import { z } from 'zod';
import { REF_RE, SCOPES } from '../../../shared/aiInsightContract.js';
import {
  ingestPastedInsight, listInsights, deleteInsight,
  savePrompt, listPrompts, deletePrompt,
} from '../services/aiInsights.js';

const router = Router();

// Corps d'une sauvegarde de prompt (déclenchée au moment de la copie).
const promptBody = z.object({
  goal: z.string().trim().min(1).max(40),
  scope: z.enum(SCOPES),
  isin: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/).nullish(),
  ref: z.string().regex(REF_RE),
  params: z.record(z.unknown()).optional(),
  prompt_text: z.string().min(1).max(20_000),
});

// GET /api/ai/prompts — historique (le plus récent d'abord).
router.get('/prompts', async (req, res, next) => {
  try {
    return res.json({ prompts: await listPrompts(req.user.id) });
  } catch (err) { return next(err); }
});

// POST /api/ai/prompts — sauvegarde un prompt généré. Idempotent par (compte, ref).
router.post('/prompts', async (req, res, next) => {
  try {
    const parsed = promptBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Prompt invalide' });
    const d = parsed.data;
    const id = await savePrompt(req.user.id, {
      goal: d.goal, scope: d.scope, isin: d.isin, ref: d.ref, params: d.params, promptText: d.prompt_text,
    });
    return res.status(201).json({ id, ref: d.ref });
  } catch (err) { return next(err); }
});

// DELETE /api/ai/prompts/:id
router.delete('/prompts/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Id invalide' });
    const ok = await deletePrompt(req.user.id, id);
    return ok ? res.json({ ok: true }) : res.status(404).json({ error: 'Prompt introuvable' });
  } catch (err) { return next(err); }
});

// POST /api/ai/insights — l'utilisateur colle la réponse ENTIÈRE de l'assistant.
router.post('/insights', async (req, res, next) => {
  try {
    const provider = ['chatgpt', 'claude', 'gemini', 'autre'].includes(req.body?.provider) ? req.body.provider : null;
    const result = await ingestPastedInsight(req.user.id, req.body?.raw, provider);
    if (result.error) return res.status(422).json({ error: result.error });
    return res.status(201).json(result);
  } catch (err) { return next(err); }
});

// GET /api/ai/insights — dernier avis par titre + dernier avis portefeuille.
router.get('/insights', async (req, res, next) => {
  try {
    return res.json(await listInsights(req.user.id));
  } catch (err) { return next(err); }
});

// DELETE /api/ai/insights/:id — droit à l'oubli d'un avis.
router.delete('/insights/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Id invalide' });
    const ok = await deleteInsight(req.user.id, id);
    return ok ? res.json({ ok: true }) : res.status(404).json({ error: 'Avis introuvable' });
  } catch (err) { return next(err); }
});

export default router;
