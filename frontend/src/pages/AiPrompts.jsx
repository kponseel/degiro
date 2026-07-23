import { useEffect, useMemo, useState } from 'react';
import { getPortfolio, getExposure } from '../lib/api.js';
import { PORTFOLIO_PROMPTS, buildStockPrompt } from '../lib/prompts.js';
import { Spinner, Card, Banner, Empty } from '../components/ui.jsx';
import { fmtEur, fmtPct } from '../lib/format.js';

const ASSISTANTS = [
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
];

function PromptCard({ title, desc, text }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setOpen(true); // clipboard indisponible : on affiche pour copier à la main
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>{desc}</div>
        </div>
        <button className="btn" onClick={copy}>{copied ? 'Copié ✓' : 'Copier'}</button>
      </div>
      <button className="link-btn" style={{ marginTop: 10 }} onClick={() => setOpen((o) => !o)}>
        {open ? 'Masquer l’aperçu' : 'Aperçu du prompt'}
      </button>
      {open && <pre className="prompt-pre">{text}</pre>}
      <div className="assistant-links">
        <span className="muted" style={{ fontSize: 12.5 }}>Coller dans :</span>
        {ASSISTANTS.map((a) => (
          <a key={a.name} className="chip" href={a.url} target="_blank" rel="noopener noreferrer">{a.name} ↗</a>
        ))}
      </div>
    </Card>
  );
}

const sectionStyle = { margin: '24px 0 12px', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--ink-soft)', fontWeight: 650 };

export default function AiPrompts() {
  const [pf, setPf] = useState(null);
  const [expo, setExpo] = useState(null);
  const [error, setError] = useState(null);
  const [selIsin, setSelIsin] = useState('');

  useEffect(() => {
    getPortfolio().then(setPf).catch((e) => setError(e.message));
    getExposure(false).then(setExpo).catch(() => {});
  }, []);

  const total = useMemo(
    () => (pf ? pf.positions.reduce((s, p) => s + (Number(p.value_eur) || 0), 0) : 0),
    [pf],
  );

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!pf) return <Spinner />;
  if (!pf.snapshot) {
    return <Card><Empty title="Aucune donnée">Importe d'abord ton portefeuille pour générer des prompts personnalisés.</Empty></Card>;
  }

  const sel = pf.positions.find((p) => p.isin === selIsin);
  const selWeight = sel ? (Number(sel.value_eur) || 0) / total : 0;
  const sorted = [...pf.positions].sort((a, b) => (b.value_eur || 0) - (a.value_eur || 0));

  return (
    <>
      <Banner kind="info">
        Ces prompts intègrent ton portefeuille réel : copie-les et colle-les dans un assistant IA gratuit
        (Gemini, Claude, ChatGPT) pour obtenir une analyse — sans payer d'API. ⚠️ Ce ne sont pas des conseils
        financiers, et tu partages tes données avec l'assistant que tu choisis.
      </Banner>

      <div style={sectionStyle}>Sur tout le portefeuille</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))' }}>
        {PORTFOLIO_PROMPTS.map((t) => (
          <PromptCard key={t.id} title={t.title} desc={t.desc} text={t.build(pf, expo)} />
        ))}
      </div>

      <div style={sectionStyle}>Sur un titre précis</div>
      <Card>
        <div className="field" style={{ maxWidth: 460 }}>
          <label htmlFor="stock">Choisir une ligne</label>
          <select id="stock" className="input" value={selIsin} onChange={(e) => setSelIsin(e.target.value)}>
            <option value="">— sélectionner un titre —</option>
            {sorted.map((p) => (
              <option key={p.isin} value={p.isin}>
                {p.name || p.symbol || p.isin} · {fmtEur(p.value_eur)} ({fmtPct((Number(p.value_eur) || 0) / total)})
              </option>
            ))}
          </select>
        </div>
      </Card>
      {sel && (
        <div style={{ marginTop: 16 }}>
          <PromptCard
            title={`Analyse — ${sel.name || sel.symbol}`}
            desc="Thèse (bull/bear), valorisation, objectifs d'achat/vente, catalyseurs, actualités."
            text={buildStockPrompt(sel, selWeight)}
          />
        </div>
      )}
    </>
  );
}
