import { useEffect, useMemo, useState } from 'react';
import { getPortfolio, getExposure, listAiPrompts, saveAiPrompt, deleteAiPrompt } from '../lib/api.js';
import { GOALS, goalById, stepDefault, assemblePrompt } from '../lib/promptWizard.js';
import { Spinner, Card, Banner, Empty } from '../components/ui.jsx';
import InsightPasteModal from '../components/InsightPasteModal.jsx';
import { fmtEur, fmtPct, fmtDate } from '../lib/format.js';

const ASSISTANTS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
];

/** Lit ?isin=… dans le hash (#/ai?isin=XXX), pour le raccourci depuis une position. */
function initialIsinFromHash() {
  const q = window.location.hash.split('?')[1];
  return q ? new URLSearchParams(q).get('isin') : null;
}

// ── Écran final : le prompt prêt à copier ────────────────────────────
function ResultStep({ built, onReset, onPasteOpen }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  async function copy() {
    try { await navigator.clipboard.writeText(built.text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setOpen(true); }
  }

  return (
    <Card>
      <div className="wiz-done-head">
        <div>
          <div style={{ fontWeight: 720, fontSize: 16 }}>Ton prompt est prêt 🎯</div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 3 }}>
            Copie-le, colle-le dans l'assistant, puis reviens coller sa réponse ici.
          </div>
        </div>
        <button className="btn" onClick={copy}>{copied ? 'Copié ✓' : 'Copier le prompt'}</button>
      </div>

      <ol className="wiz-flow">
        <li><strong>1.</strong> Ouvre un assistant :
          {ASSISTANTS.map((a) => (
            <a key={a.name} className="chip link-chip" style={{ marginLeft: 6 }} href={a.url} target="_blank" rel="noopener noreferrer">{a.name} ↗</a>
          ))}
        </li>
        <li><strong>2.</strong> Colle le prompt, envoie, attends la réponse.</li>
        <li><strong>3.</strong> Sélectionne toute la réponse, copie-la, puis :
          <button className="btn" style={{ marginLeft: 8, padding: '5px 12px', fontSize: 13 }} onClick={onPasteOpen}>Coller la réponse</button>
        </li>
      </ol>

      <button className="link-btn" onClick={() => setOpen((o) => !o)}>{open ? 'Masquer le prompt' : 'Voir le prompt'}</button>
      {open && <pre className="prompt-pre">{built.text}</pre>}

      <div style={{ marginTop: 14 }}>
        <button className="btn ghost" onClick={onReset}>← Générer un autre prompt</button>
      </div>
    </Card>
  );
}

// ── Le wizard, une question par écran ────────────────────────────────
function Wizard({ pf, expo, initialIsin, onBuilt }) {
  const total = useMemo(() => pf.positions.reduce((s, p) => s + (Number(p.value_eur) || 0), 0), [pf]);
  const sorted = useMemo(() => [...pf.positions].sort((a, b) => (b.value_eur || 0) - (a.value_eur || 0)), [pf]);

  // step -1 = choix de l'objectif ; 0..n = étapes ; puis on émet le prompt.
  const [goalId, setGoalId] = useState(null);
  const [selIsin, setSelIsin] = useState(initialIsin || '');
  const [answers, setAnswers] = useState({});
  const [step, setStep] = useState(-1);

  const goal = goalById(goalId);
  // Un objectif « titre » insère une étape de sélection en tête s'il n'a pas d'ISIN.
  const needsStockStep = goal?.needsStock && !initialIsin;
  const steps = goal ? (needsStockStep ? ['__stock', ...goal.steps] : goal.steps) : [];

  function pickGoal(g) {
    setGoalId(g.id);
    setAnswers(Object.fromEntries(g.steps.map((s) => [s.id, s.optional ? null : stepDefault(s)])));
    setStep(0);
  }

  function finish(finalAnswers) {
    const sel = goal.scope === 'position' ? sorted.find((p) => p.isin === (initialIsin || selIsin)) : null;
    onBuilt(assemblePrompt({ goalId, answers: finalAnswers, pf, expo, sel }));
  }

  function next(value) {
    const cur = steps[step];
    let a = answers;
    if (cur !== '__stock') { a = { ...answers, [cur.id]: value }; setAnswers(a); }
    if (step + 1 < steps.length) setStep(step + 1);
    else finish(a);
  }

  // ── Choix de l'objectif ──
  if (step === -1) {
    return (
      <div className="wiz-goals">
        {GOALS.map((g) => (
          <button key={g.id} className="wiz-goal" onClick={() => pickGoal(g)}>
            <span className="wiz-goal-title">{g.label}</span>
            <span className="wiz-goal-desc">{g.desc}</span>
          </button>
        ))}
      </div>
    );
  }

  const cur = steps[step];
  const progress = `${step + 1} / ${steps.length}`;

  const back = () => (step === 0 ? (setStep(-1), setGoalId(null)) : setStep(step - 1));

  return (
    <Card className="wiz-card">
      <div className="wiz-top">
        <button className="link-btn" onClick={back}>← Retour</button>
        <span className="wiz-progress">{progress}</span>
      </div>

      {cur === '__stock' ? (
        <>
          <h3 className="wiz-q">Quel titre veux-tu analyser ?</h3>
          <div className="wiz-stock-list">
            {sorted.map((p) => (
              <button
                key={p.isin}
                className={`wiz-opt ${selIsin === p.isin ? 'on' : ''}`}
                onClick={() => { setSelIsin(p.isin); next(); }}
              >
                <span>{p.name || p.symbol || p.isin}</span>
                <span className="muted">{fmtEur(p.value_eur)} · {fmtPct((Number(p.value_eur) || 0) / total)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <h3 className="wiz-q">{cur.label}</h3>
          <div className="wiz-opts">
            {cur.options.map((o) => (
              <button key={o.value} className={`wiz-opt ${answers[cur.id] === o.value ? 'on' : ''}`} onClick={() => next(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
          {cur.optional && (
            <button className="link-btn wiz-skip" onClick={() => next(null)}>Passer cette étape →</button>
          )}
        </>
      )}
    </Card>
  );
}

// ── Historique ───────────────────────────────────────────────────────
function History({ items, onReuse, onDelete }) {
  if (!items?.length) return null;
  return (
    <Card title="Mes prompts précédents">
      <div className="table-wrap">
        <table className="data compact">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Objectif</th>
              <th style={{ textAlign: 'left' }}>Titre</th>
              <th>Créé le</th>
              <th>Réponse</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>{goalById(p.goal)?.label || p.goal}</td>
                <td>{p.isin ? <code className="muted">{p.isin}</code> : <span className="muted">portefeuille</span>}</td>
                <td>{fmtDate(p.created_at)}</td>
                <td style={{ textAlign: 'center' }}>{p.has_insight ? '✓' : <span className="muted">—</span>}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn ghost" style={{ padding: '4px 10px', fontSize: 12.5 }} onClick={() => onReuse(p)}>Revoir</button>
                  <button className="link-btn danger-text" style={{ marginLeft: 10 }} onClick={() => onDelete(p.id)}>Suppr.</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function AiPrompts() {
  const [pf, setPf] = useState(null);
  const [expo, setExpo] = useState(null);
  const [error, setError] = useState(null);
  const [built, setBuilt] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [wizardKey, setWizardKey] = useState(0);
  const initialIsin = useMemo(initialIsinFromHash, []);

  const reloadHistory = () => listAiPrompts().then((d) => setHistory(d.prompts || [])).catch(() => {});

  useEffect(() => {
    getPortfolio().then(setPf).catch((e) => setError(e.message));
    getExposure(false).then(setExpo).catch(() => {});
    reloadHistory();
  }, []);

  // Prompt généré → on le sauvegarde (historique), puis on affiche l'écran final.
  async function onBuilt(result) {
    setBuilt(result);
    try {
      await saveAiPrompt({ goal: result.goal, scope: result.scope, isin: result.isin, ref: result.ref, prompt_text: result.text });
      reloadHistory();
    } catch { /* la sauvegarde échoue en silence : le prompt reste utilisable */ }
  }

  function reset() { setBuilt(null); setWizardKey((k) => k + 1); }

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!pf) return <Spinner />;
  if (!pf.snapshot) {
    return <Card><Empty title="Aucune donnée">Importe d'abord ton portefeuille pour générer des prompts personnalisés.</Empty></Card>;
  }

  return (
    <>
      <div className="page-head">
        <h1>Générateur de prompts IA</h1>
        <p>
          Réponds à quelques questions : l'app fabrique un prompt sur mesure, rempli avec ton portefeuille.
          Colle-le dans l'assistant de ton choix — puis colle sa réponse ici pour enrichir ton tableau de bord.
        </p>
      </div>

      <Banner kind="info">
        ⚠️ Ce ne sont pas des conseils financiers, et tu partages tes données avec l'assistant que tu choisis (gratuit).
      </Banner>

      <div style={{ marginTop: 16 }}>
        {built
          ? <ResultStep built={built} onReset={reset} onPasteOpen={() => setPasteOpen(true)} />
          : <Wizard key={wizardKey} pf={pf} expo={expo} initialIsin={initialIsin} onBuilt={onBuilt} />}
      </div>

      <div style={{ marginTop: 18 }}>
        <History
          items={history}
          onReuse={(p) => setBuilt({ text: p.prompt_text, ref: p.ref, scope: p.scope, isin: p.isin, goal: p.goal })}
          onDelete={async (id) => { await deleteAiPrompt(id).catch(() => {}); reloadHistory(); }}
        />
      </div>

      {pasteOpen && <InsightPasteModal onClose={() => setPasteOpen(false)} onIngested={() => reloadHistory()} />}
    </>
  );
}
