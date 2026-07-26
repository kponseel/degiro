import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { resetDb } from './helpers.js';
import { extractDataBlock } from '../src/services/aiInsights.js';
import { buildFormatInstructions, makeRef, REF_RE } from '../../shared/aiInsightContract.js';

const app = createApp();

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await closePool(); });

async function signIn(email) {
  const agent = request.agent(app);
  const link = await agent.post('/api/auth/request-link').send({ email });
  await agent.post('/api/auth/verify').send({ token: new URL(link.body.devLink).searchParams.get('token') });
  return agent;
}

/** Crée un prompt sauvegardé et renvoie sa ref (préalable à toute ingestion). */
async function seedPrompt(agent, { scope = 'position', isin = 'US67066G1040', goal = 'these' } = {}) {
  const ref = makeRef();
  const res = await agent.post('/api/ai/prompts').send({
    goal, scope, isin: scope === 'position' ? isin : null, ref,
    params: { horizon: 12 }, prompt_text: `PROMPT ${buildFormatInstructions({ ref, scope, isin })}`,
  });
  expect(res.status).toBe(201);
  return ref;
}

/** Bloc de données valide, tel que produit par un assistant. */
const validBlock = (ref, extra = {}) => ({
  schema_version: 1,
  ref,
  scope: 'position',
  isin: 'US67066G1040',
  as_of: '2026-07-26',
  risk_score: 7,
  quality_score: 8,
  recommendation: 'hold',
  confidence: 'medium',
  fair_value: { amount: 180, currency: 'USD' },
  bull_points: ['Position dominante sur les puces IA'],
  bear_points: ['Valorisation exigeante'],
  summary: 'Solide mais chère.',
  ...extra,
});

/** Réponse réaliste d'assistant : analyse lisible + bloc à la fin. */
const aiAnswer = (block) => `Voici mon analyse de NVIDIA.

## Points forts
L'entreprise domine son marché...

## Risques
La valorisation reste élevée...

En résumé : position à conserver.

\`\`\`json
${JSON.stringify(block, null, 2)}
\`\`\``;

// ── Extraction (fonction pure) ───────────────────────────────────────

describe('extraction du bloc dans un texte collé', () => {
  const block = validBlock('p_abcd1234');

  it('retrouve le bloc balisé à la fin d’une réponse normale', () => {
    expect(extractDataBlock(aiAnswer(block))).toEqual(block);
  });

  it('retrouve un bloc balisé sans le tag json', () => {
    expect(extractDataBlock(`Analyse…\n\`\`\`\n${JSON.stringify(block)}\n\`\`\``)).toEqual(block);
  });

  it('retrouve un bloc nu, sans balises du tout', () => {
    expect(extractDataBlock(`L'assistant a répondu ceci : ${JSON.stringify(block)} Voilà.`)).toEqual(block);
  });

  it('prend le DERNIER bloc quand l’analyse cite d’autres extraits de code', () => {
    const decoy = '```json\n{"exemple": "sans rapport", "ref": null}\n```';
    expect(extractDataBlock(`${decoy}\n\nAnalyse…\n${aiAnswer(block)}`)).toEqual(block);
  });

  it('ignore les objets quelconques sans référence', () => {
    expect(extractDataBlock('Voici {"pas": "le bon objet"} dans du texte.')).toBeNull();
  });

  it('renvoie null sur du texte sans bloc, du JSON cassé, ou du vide', () => {
    expect(extractDataBlock('Une réponse sans aucune donnée structurée.')).toBeNull();
    expect(extractDataBlock('```json\n{"ref": "p_x", cassé\n```')).toBeNull();
    expect(extractDataBlock('')).toBeNull();
    expect(extractDataBlock(null)).toBeNull();
  });

  it('survit aux accolades dans les chaînes', () => {
    const tricky = { ...block, summary: 'Attention aux {accolades} et aux "guillemets" ici' };
    expect(extractDataBlock(aiAnswer(tricky))).toEqual(tricky);
  });
});

describe('contrat partagé', () => {
  it('makeRef produit des références conformes', () => {
    for (let i = 0; i < 20; i += 1) expect(makeRef()).toMatch(REF_RE);
  });

  it('les instructions embarquent ref, isin et version', () => {
    const text = buildFormatInstructions({ ref: 'p_zz00zz00', scope: 'position', isin: 'FR0000120271' });
    expect(text).toContain('"ref": "p_zz00zz00"');
    expect(text).toContain('"isin": "FR0000120271"');
    expect(text).toContain('"schema_version": 1');
  });
});

// ── Ingestion via l'API ──────────────────────────────────────────────

describe('POST /api/ai/insights — collage de la réponse', () => {
  it('accepte une réponse d’assistant complète et renvoie l’avis', async () => {
    const agent = await signIn('alice@example.com');
    const ref = await seedPrompt(agent);

    const res = await agent.post('/api/ai/insights')
      .send({ raw: aiAnswer(validBlock(ref)), provider: 'chatgpt' });
    expect(res.status).toBe(201);
    expect(res.body.insight.isin).toBe('US67066G1040');

    const list = await agent.get('/api/ai/insights');
    const insight = list.body.byIsin.US67066G1040;
    expect(insight.risk_score).toBe(7);
    expect(insight.recommendation).toBe('hold');
    expect(Number(insight.fair_value)).toBe(180);
    expect(insight.provider).toBe('chatgpt');
    expect(insight.payload.bull_points).toHaveLength(1);
  });

  it('explique en français quand aucun bloc n’est trouvé', async () => {
    const agent = await signIn('alice@example.com');
    await seedPrompt(agent);
    const res = await agent.post('/api/ai/insights').send({ raw: 'Une réponse sans bloc de données.' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('réponse ENTIÈRE');
    expect(res.body.error).not.toMatch(/json|schema|zod/i); // pas de jargon
  });

  it('refuse un score hors bornes ou une recommandation inventée, sans jargon', async () => {
    const agent = await signIn('alice@example.com');
    const ref = await seedPrompt(agent);
    for (const bad of [{ risk_score: 11 }, { recommendation: 'yolo' }]) {
      const res = await agent.post('/api/ai/insights').send({ raw: aiAnswer(validBlock(ref, bad)) });
      expect(res.status).toBe(422);
      expect(res.body.error).toContain('incomplet ou altéré');
    }
  });

  it('tronque les textes trop longs au lieu de refuser', async () => {
    const agent = await signIn('alice@example.com');
    const ref = await seedPrompt(agent);
    const res = await agent.post('/api/ai/insights')
      .send({ raw: aiAnswer(validBlock(ref, { summary: 'x'.repeat(2000) })) });
    expect(res.status).toBe(201);
    const { body } = await agent.get('/api/ai/insights');
    expect(body.byIsin.US67066G1040.summary).toHaveLength(500);
  });

  it('refuse une référence inconnue (réponse d’un prompt étranger à l’app)', async () => {
    const agent = await signIn('alice@example.com');
    const res = await agent.post('/api/ai/insights').send({ raw: aiAnswer(validBlock('p_inconnu0')) });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('aucun prompt généré ici');
  });

  it('refuse une réponse collée sur le mauvais titre', async () => {
    const agent = await signIn('alice@example.com');
    const ref = await seedPrompt(agent, { isin: 'FR0000120271' }); // prompt sur Air Liquide
    const res = await agent.post('/api/ai/insights').send({ raw: aiAnswer(validBlock(ref)) }); // réponse NVIDIA
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('Vérifie');
  });

  it('la ref d’un autre compte ne marche pas (cloisonnement)', async () => {
    const alice = await signIn('alice@example.com');
    const bob = await signIn('bob@example.com');
    const refAlice = await seedPrompt(alice);
    const res = await bob.post('/api/ai/insights').send({ raw: aiAnswer(validBlock(refAlice)) });
    expect(res.status).toBe(422);
  });

  it('un avis portefeuille éclate ses notes par titre (fan-out)', async () => {
    const agent = await signIn('alice@example.com');
    const ref = await seedPrompt(agent, { scope: 'portfolio', goal: 'risque' });

    const block = {
      schema_version: 1, ref, scope: 'portfolio', as_of: '2026-07-26',
      risk_score: 6, diversification_score: 4, confidence: 'high',
      warnings: [{ severity: 'high', label: 'Tech > 60 % du portefeuille', isin: null }],
      suggested_actions: [{ action: 'reduce', isin: 'US67066G1040', rationale: 'Concentration excessive' }],
      positions: [
        { isin: 'US67066G1040', risk_score: 8, recommendation: 'reduce', note: 'Poids excessif' },
        { isin: 'IE00B4L5Y983', risk_score: 3, recommendation: 'buy' },
      ],
      summary: 'Portefeuille concentré sur la tech américaine.',
    };
    const res = await agent.post('/api/ai/insights').send({ raw: aiAnswer(block) });
    expect(res.status).toBe(201);
    expect(res.body.fanout).toBe(2);

    const { body } = await agent.get('/api/ai/insights');
    expect(body.portfolio.risk_score).toBe(6);
    expect(body.portfolio.payload.warnings[0].label).toContain('Tech');
    expect(body.byIsin.US67066G1040.recommendation).toBe('reduce');
    expect(body.byIsin.IE00B4L5Y983.risk_score).toBe(3);
  });

  it('le dernier avis sur un titre remplace l’ancien à l’affichage', async () => {
    const agent = await signIn('alice@example.com');
    const ref1 = await seedPrompt(agent);
    await agent.post('/api/ai/insights').send({ raw: aiAnswer(validBlock(ref1, { risk_score: 3 })) });
    const ref2 = await seedPrompt(agent);
    await agent.post('/api/ai/insights').send({ raw: aiAnswer(validBlock(ref2, { risk_score: 9 })) });

    const { body } = await agent.get('/api/ai/insights');
    expect(body.byIsin.US67066G1040.risk_score).toBe(9);
  });
});

// ── Historique des prompts ───────────────────────────────────────────

describe('historique des prompts', () => {
  it('sauvegarde, liste (avec indicateur de réponse) et supprime', async () => {
    const agent = await signIn('alice@example.com');
    const ref = await seedPrompt(agent);

    let { body } = await agent.get('/api/ai/prompts');
    expect(body.prompts).toHaveLength(1);
    expect(body.prompts[0].has_insight).toBe(false);
    expect(body.prompts[0].params).toEqual({ horizon: 12 });

    await agent.post('/api/ai/insights').send({ raw: aiAnswer(validBlock(ref)) });
    ({ body } = await agent.get('/api/ai/prompts'));
    expect(body.prompts[0].has_insight).toBe(true);

    const del = await agent.delete(`/api/ai/prompts/${body.prompts[0].id}`);
    expect(del.status).toBe(200);
    ({ body } = await agent.get('/api/ai/prompts'));
    expect(body.prompts).toHaveLength(0);
  });

  it('re-sauvegarder la même ref met à jour au lieu de dupliquer', async () => {
    const agent = await signIn('alice@example.com');
    const ref = makeRef();
    const save = (text) => agent.post('/api/ai/prompts').send({
      goal: 'these', scope: 'position', isin: 'US67066G1040', ref, prompt_text: text,
    });
    await save('v1');
    await save('v2');
    const { body } = await agent.get('/api/ai/prompts');
    expect(body.prompts).toHaveLength(1);
    expect(body.prompts[0].prompt_text).toBe('v2');
  });

  it('chaque compte ne voit que ses prompts et ses avis', async () => {
    const alice = await signIn('alice@example.com');
    const bob = await signIn('bob@example.com');
    const ref = await seedPrompt(alice);
    await alice.post('/api/ai/insights').send({ raw: aiAnswer(validBlock(ref)) });

    expect((await bob.get('/api/ai/prompts')).body.prompts).toHaveLength(0);
    expect((await bob.get('/api/ai/insights')).body.byIsin).toEqual({});

    // Bob ne peut pas supprimer chez Alice.
    const { body } = await alice.get('/api/ai/prompts');
    expect((await bob.delete(`/api/ai/prompts/${body.prompts[0].id}`)).status).toBe(404);
  });

  it('« Effacer mes données » purge prompts et avis', async () => {
    const agent = await signIn('alice@example.com');
    const ref = await seedPrompt(agent);
    await agent.post('/api/ai/insights').send({ raw: aiAnswer(validBlock(ref)) });

    await agent.delete('/api/auth/me/data');

    expect((await agent.get('/api/ai/prompts')).body.prompts).toHaveLength(0);
    expect((await agent.get('/api/ai/insights')).body.byIsin).toEqual({});
  });
});
