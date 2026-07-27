import { getPool } from '../db/pool.js';
import { insightSchema } from '../schemas/aiInsight.js';
import { LIMITS } from '../../../shared/aiInsightContract.js';

/**
 * Ré-ingestion des analyses d'IA collées par l'utilisateur.
 *
 * Le public visé ne veut ni JSON ni manipulation de fichiers : il colle la
 * réponse ENTIÈRE de l'assistant (analyse lisible + bloc de données à la fin,
 * comme le prompt l'exige). D'où la règle : extraction tolérante — le bloc
 * peut être noyé dans du texte, avec ou sans balises — puis validation
 * stricte de ce qui a été trouvé.
 */

// ── Extraction ───────────────────────────────────────────────────────

/** Au-delà, on cesse de chercher : un avis d'IA n'a pas mille objets imbriqués. */
const MAX_CANDIDATES = 200;

/**
 * Candidats { … } équilibrés d'un texte, accolades comptées hors chaînes.
 *
 * Une seule passe, avec une pile des accolades ouvrantes : la version précédente
 * repartait de CHAQUE `{` et rebalayait jusqu'à la fin du texte, soit un coût
 * quadratique. Sur un collage de 200 000 caractères riche en accolades, cela
 * figeait le processus — qui sert aussi le site — pendant des dizaines de
 * secondes. Ici chaque caractère est lu une fois.
 */
function balancedObjects(text) {
  const out = [];
  const stack = [];
  let inString = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') stack.push(i);
    else if (c === '}' && stack.length) {
      const start = stack.pop();
      out.push(text.slice(start, i + 1));
      if (out.length >= MAX_CANDIDATES) break;
    }
  }
  // Les objets les plus englobants d'abord : `extractDataBlock` retient le
  // premier candidat exploitable, et l'ancienne version les produisait dans cet
  // ordre (extérieur avant intérieur).
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Retrouve le bloc de données dans un texte collé. Renvoie l'objet parsé, ou
 * null. Les blocs balisés sont tentés d'abord, du DERNIER au premier : le
 * prompt demande le bloc en fin de réponse, et l'analyse qui précède peut
 * elle-même contenir des extraits de code.
 */
export function extractDataBlock(raw) {
  const text = String(raw ?? '').slice(0, LIMITS.rawPaste);
  const candidates = [];

  const fenced = [...text.matchAll(/```[a-z]*\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  candidates.push(...fenced.reverse());
  candidates.push(...balancedObjects(text).reverse());

  for (const candidate of candidates) {
    const body = candidate.trim();
    if (!body.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(body);
      // Le bloc attendu se reconnaît à sa référence — pas un objet quelconque
      // que l'IA aurait cité dans son analyse.
      if (parsed && typeof parsed === 'object' && 'ref' in parsed) return parsed;
    } catch { /* candidat suivant */ }
  }
  return null;
}

// ── Messages d'erreur pour humains ───────────────────────────────────

/** Traduit les erreurs zod en une phrase lisible (pas de jargon technique). */
function humanizeIssues(issues) {
  const fields = [...new Set(issues.map((i) => i.path.filter((p) => typeof p === 'string')[0] || 'bloc'))];
  return `Le bloc de données de l'assistant est incomplet ou altéré (champ${fields.length > 1 ? 's' : ''} : ${fields.slice(0, 4).join(', ')}). `
    + "Redemande à l'assistant de terminer sa réponse par le bloc exact du prompt, puis recolle la réponse entière.";
}

// ── Ingestion ────────────────────────────────────────────────────────

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Ingestion d'une réponse collée.
 * @returns {{ error: string } | { insight: object, fanout: number }}
 */
export async function ingestPastedInsight(accountId, raw, provider) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { error: "Colle d'abord la réponse de l'assistant (le champ est vide)." };
  }
  if (raw.length > LIMITS.rawPaste) {
    return { error: 'Le texte collé est anormalement long — copie uniquement la réponse de l\'assistant.' };
  }

  const block = extractDataBlock(raw);
  if (!block) {
    return {
      error: "Je n'ai pas trouvé le bloc de données dans ce texte. Copie la réponse ENTIÈRE de l'assistant "
        + '(le bloc se trouve tout à la fin), sans la retaper à la main.',
    };
  }

  const parsed = insightSchema.safeParse(block);
  if (!parsed.success) return { error: humanizeIssues(parsed.error.issues) };
  const data = parsed.data;

  const pool = getPool();

  // La référence relie la réponse au prompt généré ici — et empêche de coller
  // une analyse sur la mauvaise ligne du portefeuille.
  const [prompts] = await pool.query(
    'SELECT id, scope, isin FROM ai_prompts WHERE account_id = ? AND ref = ?',
    [accountId, data.ref],
  );
  if (!prompts.length) {
    return { error: "Cette réponse ne correspond à aucun prompt généré ici. Regénère le prompt dans l'app, repose la question à l'assistant, puis colle sa réponse." };
  }
  const prompt = prompts[0];
  if (prompt.scope !== data.scope || (data.scope === 'position' && prompt.isin && prompt.isin !== data.isin)) {
    return { error: `Cette réponse concerne ${data.scope === 'position' ? `le titre ${data.isin}` : 'tout le portefeuille'}, mais le prompt d'origine portait sur ${prompt.scope === 'position' ? `le titre ${prompt.isin}` : 'tout le portefeuille'}. Vérifie que tu colles la bonne réponse.` };
  }

  const insertOne = async (scope, isin, extract, payload) => {
    const [res] = await pool.query(
      `INSERT INTO ai_insights
         (account_id, prompt_id, scope, isin, provider, risk_score, recommendation,
          confidence, fair_value, fair_value_ccy, summary, as_of, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        accountId, prompt.id, scope, isin, provider || null,
        num(extract.risk_score), extract.recommendation || null, extract.confidence || null,
        extract.fair_value ? num(extract.fair_value.amount) : null,
        extract.fair_value ? extract.fair_value.currency : null,
        extract.summary || null, extract.as_of || null,
        JSON.stringify(payload),
      ],
    );
    return res.insertId;
  };

  let fanout = 0;
  const id = await insertOne(data.scope, data.scope === 'position' ? data.isin : null, data, data);

  // Un avis « portefeuille » peut noter chaque ligne : on éclate ces notes en
  // avis par ISIN, pour que le panneau de détail de chaque position les voie.
  if (data.scope === 'portfolio' && data.positions?.length) {
    for (const p of data.positions) {
      await insertOne('position', p.isin, { ...p, confidence: data.confidence, as_of: data.as_of, summary: p.note || null }, p);
      fanout += 1;
    }
  }

  return { insight: { id, scope: data.scope, isin: data.scope === 'position' ? data.isin : null }, fanout };
}

// ── Lecture ──────────────────────────────────────────────────────────

const parsePayload = (row) => ({
  ...row,
  payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
});

/** Dernier avis par ISIN + dernier avis portefeuille, pour badges et panneaux. */
export async function listInsights(accountId) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT i.* FROM ai_insights i
     JOIN (SELECT scope, isin, MAX(id) AS id FROM ai_insights
           WHERE account_id = ? GROUP BY scope, isin) last ON last.id = i.id
     ORDER BY i.id DESC`,
    [accountId],
  );
  const byIsin = {};
  let portfolio = null;
  for (const row of rows.map(parsePayload)) {
    if (row.scope === 'portfolio') portfolio = portfolio || row;
    else if (row.isin && !byIsin[row.isin]) byIsin[row.isin] = row;
  }
  return { portfolio, byIsin };
}

export async function deleteInsight(accountId, id) {
  const pool = getPool();
  const [res] = await pool.query('DELETE FROM ai_insights WHERE account_id = ? AND id = ?', [accountId, id]);
  return res.affectedRows > 0;
}

// ── Historique des prompts ───────────────────────────────────────────

export async function savePrompt(accountId, { goal, scope, isin, ref, params, promptText }) {
  const pool = getPool();
  // Regénérer un prompt réutilise parfois la même référence (bouton recopié) :
  // l'unicité (account, ref) fait alors office d'idempotence.
  const [res] = await pool.query(
    `INSERT INTO ai_prompts (account_id, goal, scope, isin, ref, params, prompt_text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE prompt_text = VALUES(prompt_text), params = VALUES(params), id = LAST_INSERT_ID(id)`,
    [accountId, goal, scope, isin || null, ref, params ? JSON.stringify(params) : null, promptText],
  );
  return res.insertId;
}

export async function listPrompts(accountId, limit = 50) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT p.id, p.goal, p.scope, p.isin, p.ref, p.params, p.prompt_text, p.created_at,
            EXISTS(SELECT 1 FROM ai_insights i WHERE i.prompt_id = p.id) AS has_insight
     FROM ai_prompts p
     WHERE p.account_id = ?
     ORDER BY p.id DESC
     LIMIT ?`,
    [accountId, limit],
  );
  return rows.map((r) => ({
    ...r,
    params: typeof r.params === 'string' ? JSON.parse(r.params) : r.params,
    has_insight: Boolean(r.has_insight),
  }));
}

export async function deletePrompt(accountId, id) {
  const pool = getPool();
  const [res] = await pool.query('DELETE FROM ai_prompts WHERE account_id = ? AND id = ?', [accountId, id]);
  return res.affectedRows > 0;
}

/** Purge complète d'un compte (suppression des données ou du compte). */
export async function deleteAiData(accountId) {
  const pool = getPool();
  await pool.query('DELETE FROM ai_insights WHERE account_id = ?', [accountId]);
  await pool.query('DELETE FROM ai_prompts WHERE account_id = ?', [accountId]);
}
