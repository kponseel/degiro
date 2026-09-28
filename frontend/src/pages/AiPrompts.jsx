import { useEffect, useMemo, useState } from 'react';
import { getPortfolio, getExposure } from '../lib/api.js';
import {
  buildPrompt, objectivesFor, isinsFromHash, plPct, totalValue,
  HORIZONS, PROFILES, LENGTHS, CASH, MIN_VALUES, DEFAULT_OPTIONS,
} from '../lib/promptBuilder.js';
import { Spinner, Card, Banner, Empty, SearchInput } from '../components/ui.jsx';
import { fmtEur, fmtPct, toneOf } from '../lib/format.js';

const ASSISTANTS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai/' },
];

/** Objectif proposé par défaut à l'arrivée sur une portée. */
const DEFAULT_OBJECTIVE = { stocks: 'analyse', portfolio: 'bilan' };

function Segmented({ value, onChange, items, label }) {
  return (
    <div className="pb-seg" role="radiogroup" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="radio"
          aria-checked={value === it.value}
          className={value === it.value ? 'on' : ''}
          onClick={() => onChange(it.value)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Liste de titres à cocher, filtrable. */
function StockPicker({ positions, total, selected, onChange }) {
  const [q, setQ] = useState('');
  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return positions;
    return positions.filter((p) => `${p.name || ''} ${p.isin || ''} ${p.ticker || p.symbol || ''} ${p.sector || ''}`
      .toLowerCase().includes(t));
  }, [positions, q]);

  const toggle = (isin) => {
    const next = new Set(selected);
    if (next.has(isin)) next.delete(isin); else next.add(isin);
    onChange(positions.map((p) => p.isin).filter((i) => next.has(i)));
  };
  // « Tout » ne coche que ce qui est affiché : filtrer « tech » puis « Tout »
  // doit sélectionner les titres tech, pas le portefeuille entier.
  const selectVisible = () => {
    const next = new Set([...selected, ...visible.map((p) => p.isin)]);
    onChange(positions.map((p) => p.isin).filter((i) => next.has(i)));
  };

  return (
    <div className="pb-picker">
      <div className="pb-picker-bar">
        <SearchInput value={q} onChange={setQ} placeholder="Filtrer (nom, ISIN, secteur)…" label="Filtrer les titres" />
        <button type="button" className="link-btn" onClick={selectVisible}>Tout cocher</button>
        <button type="button" className="link-btn" onClick={() => onChange([])} disabled={!selected.length}>Aucun</button>
      </div>
      <div className="pb-stock-list">
        {visible.map((p) => {
          const pl = plPct(p);
          return (
            <label key={p.isin} className={`pb-stock ${selected.includes(p.isin) ? 'on' : ''}`}>
              <input type="checkbox" checked={selected.includes(p.isin)} onChange={() => toggle(p.isin)} />
              <span className="pb-stock-name" title={p.name || p.isin}>{p.name || p.symbol || p.isin}</span>
              <span className="pb-stock-meta">
                {fmtEur(p.value_eur)} · {fmtPct(total > 0 ? (Number(p.value_eur) || 0) / total : null)}
                {pl != null && <span className={toneOf(pl)}> · {pl > 0 ? '+' : ''}{fmtPct(pl)}</span>}
              </span>
            </label>
          );
        })}
        {!visible.length && <div className="muted" style={{ padding: 10 }}>Aucun titre ne correspond.</div>}
      </div>
      <div className="muted sm" style={{ marginTop: 8 }}>
        {selected.length ? `${selected.length} titre${selected.length > 1 ? 's' : ''} sélectionné${selected.length > 1 ? 's' : ''}` : 'Coche un ou plusieurs titres.'}
      </div>
    </div>
  );
}

function PromptOutput({ built }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  // Le texte change à chaque réglage : un « Copié ✓ » resté affiché laisserait
  // croire que la dernière version est dans le presse-papiers.
  useEffect(() => { setCopied(false); }, [built.text]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(built.text);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Presse-papiers refusé (permission, page non sécurisée) : le texte reste
      // sélectionnable dans la zone ci-dessous.
      setCopyFailed(true);
    }
  }

  return (
    <Card className="pb-output">
      <div className="pb-output-head">
        <div>
          <div style={{ fontWeight: 720, fontSize: 16 }}>Ton prompt</div>
          <div className="muted sm">{built.text.length.toLocaleString('fr-FR')} caractères · se met à jour à chaque réglage</div>
        </div>
        <button className="btn" onClick={copy}>{copied ? 'Copié ✓' : 'Copier le prompt'}</button>
      </div>
      {copyFailed && (
        <Banner kind="warn">Copie automatique refusée par le navigateur : sélectionne le texte ci-dessous (Ctrl+A dans la zone) puis copie-le.</Banner>
      )}
      <textarea
        className="pb-text"
        readOnly
        value={built.text}
        aria-label="Prompt généré"
        onFocus={(e) => e.target.select()}
      />
      <div className="assistant-links">
        <span className="muted sm">Puis colle-le dans :</span>
        {ASSISTANTS.map((a) => (
          <a key={a.name} className="chip link-chip" href={a.url} target="_blank" rel="noopener noreferrer">{a.name} ↗</a>
        ))}
      </div>
      <div className="muted sm" style={{ marginTop: 8 }}>
        Astuce : choisis le modèle le plus récent proposé et active la recherche web si l'option existe.
      </div>
    </Card>
  );
}

export default function AiPrompts({ onGoImport }) {
  const [pf, setPf] = useState(null);
  const [expo, setExpo] = useState(null);
  const [error, setError] = useState(null);

  const [scope, setScope] = useState('portfolio');
  const [selected, setSelected] = useState([]);
  const [objective, setObjective] = useState(DEFAULT_OBJECTIVE.portfolio);
  const [opts, setOpts] = useState({ ...DEFAULT_OPTIONS });
  const set = (k) => (v) => setOpts((o) => ({ ...o, [k]: v }));

  useEffect(() => {
    getPortfolio()
      .then((d) => {
        setPf(d);
        // Raccourci « Préparer un prompt » depuis le détail d'une position.
        const fromHash = isinsFromHash(window.location.hash, d.positions);
        if (fromHash.length) {
          setScope('stocks');
          setSelected(fromHash);
          setObjective(DEFAULT_OBJECTIVE.stocks);
        }
      })
      .catch((e) => setError(e.message));
    // L'exposition n'enrichit que le contexte « portefeuille » : son absence
    // n'empêche rien.
    getExposure(false).then(setExpo).catch(() => {});
  }, []);

  const positions = useMemo(
    () => [...(pf?.positions || [])].sort((a, b) => (Number(b.value_eur) || 0) - (Number(a.value_eur) || 0)),
    [pf],
  );
  const total = useMemo(() => totalValue(positions), [positions]);

  const available = objectivesFor(scope, selected.length);
  // L'objectif retenu doit exister pour la portée courante : « Comparer » ne
  // survit pas au décochage du deuxième titre, on retombe alors sur le premier.
  const effective = available.some((o) => o.id === objective) ? objective : available[0]?.id;
  const current = available.find((o) => o.id === effective);

  const built = useMemo(
    () => (pf ? buildPrompt({ pf, exposure: expo, scope, isins: selected, objective: effective, options: opts }) : null),
    [pf, expo, scope, selected, effective, opts],
  );

  function changeScope(s) {
    setScope(s);
    setObjective(DEFAULT_OBJECTIVE[s]);
  }

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!pf) return <Spinner />;
  if (!pf.snapshot || !positions.length) {
    return (
      <Card>
        <Empty title="Aucune position">
          Importe d'abord ton portefeuille pour générer des prompts remplis avec tes chiffres.
          {onGoImport && <div style={{ marginTop: 12 }}><button className="btn" onClick={onGoImport}>Importer →</button></div>}
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Prompts IA</h1>
        <p>
          Choisis sur quoi porte l'analyse et ce que tu veux savoir : le prompt se remplit avec tes chiffres.
          Copie-le et colle-le dans l'assistant de ton choix.
        </p>
      </div>

      <Banner kind="info">
        Ce ne sont pas des conseils financiers. En collant le prompt, tu partages ces chiffres avec l'assistant choisi.
      </Banner>

      <div className="pb-layout">
        <div className="pb-config">
          <Card title="1. Sur quoi ?">
            <Segmented
              label="Portée de l'analyse"
              value={scope}
              onChange={changeScope}
              items={[
                { value: 'portfolio', label: 'Tout le portefeuille' },
                { value: 'stocks', label: 'Titres choisis' },
              ]}
            />
            <div style={{ marginTop: 12 }}>
              {scope === 'stocks' ? (
                <StockPicker positions={positions} total={total} selected={selected} onChange={setSelected} />
              ) : (
                <label className="pb-field">
                  <span>Lignes incluses</span>
                  <select className="filter-select" value={opts.minValue} onChange={(e) => set('minValue')(Number(e.target.value))}>
                    {MIN_VALUES.map((v) => (
                      <option key={v} value={v}>
                        {v ? `Plus de ${fmtEur(v)} (${positions.filter((p) => (Number(p.value_eur) || 0) >= v).length} lignes)` : `Toutes (${positions.length} lignes)`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </Card>

          <Card title="2. Objectif">
            {available.length ? (
              <div className="pb-goals" role="radiogroup" aria-label="Objectif">
                {available.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={o.id === effective}
                    className={`pb-goal ${o.id === effective ? 'on' : ''}`}
                    onClick={() => setObjective(o.id)}
                  >
                    <span className="pb-goal-title">{o.label}</span>
                    <span className="pb-goal-desc">{o.desc}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="muted">Sélectionne au moins un titre.</div>
            )}
            {scope === 'stocks' && selected.length === 1 && (
              <div className="muted sm" style={{ marginTop: 10 }}>Coche un deuxième titre pour pouvoir les comparer.</div>
            )}
          </Card>

          <Card title="3. Réglages">
            <div className="pb-fields">
              <div className="pb-field">
                <span>Horizon</span>
                <Segmented label="Horizon" value={opts.horizon} onChange={set('horizon')} items={HORIZONS} />
              </div>
              <div className="pb-field">
                <span>Profil</span>
                <Segmented label="Profil" value={opts.profile} onChange={set('profile')} items={PROFILES} />
              </div>
              <div className="pb-field">
                <span>Réponse</span>
                <Segmented label="Longueur de la réponse" value={opts.length} onChange={set('length')} items={LENGTHS} />
              </div>
              {current?.usesCash && (
                <div className="pb-field">
                  <span>Budget</span>
                  <Segmented label="Budget" value={opts.cash} onChange={set('cash')} items={CASH} />
                </div>
              )}
              <label className="pb-check">
                <input type="checkbox" checked={opts.web || Boolean(current?.web)} disabled={Boolean(current?.web)} onChange={(e) => set('web')(e.target.checked)} />
                <span>Demander d'utiliser la recherche web {current?.web && <span className="muted">(indispensable pour cet objectif)</span>}</span>
              </label>
              <label className="pb-field">
                <span>Précision (facultatif)</span>
                <textarea
                  className="pb-note"
                  rows={2}
                  maxLength={600}
                  value={opts.note}
                  placeholder="Ex. : j'ai besoin de 5 000 € dans un an · je vise un revenu régulier…"
                  onChange={(e) => set('note')(e.target.value)}
                />
              </label>
            </div>
          </Card>
        </div>

        <div className="pb-result">
          {built?.error
            ? <Card><div className="muted">{built.error}</div></Card>
            : built && <PromptOutput built={built} />}
        </div>
      </div>
    </>
  );
}
