import { useState } from 'react';
import { uploadCsv, getToken, setToken, clearToken, enrichNow } from '../lib/api.js';
import { Card, Banner } from '../components/ui.jsx';
import IsinEditor from '../components/IsinEditor.jsx';

const KIND_LABEL = { portfolio: 'Portefeuille', account: 'Relevé de compte', transactions: 'Transactions' };

function Uploader({ hint, title, description, onImported }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function choose(f) {
    setFile(f); setPreview(null); setResult(null); setError(null);
    if (!f) return;
    setBusy(true);
    try {
      const res = await uploadCsv(f, hint, 'preview');
      setPreview(res);
    } catch (e) {
      setError(e.body?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const res = await uploadCsv(file, preview.kind, 'commit');
      setResult(res);
      setPreview(null);
      onImported?.();
    } catch (e) {
      setError(e.body?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uploader">
      <div className={`drop ${file ? 'armed' : ''}`}>
        <div className="meta">
          <span className="k">{title}</span>
          <span className="d">{file ? file.name : description}</span>
        </div>
        <label className="btn ghost">
          {file ? 'Changer' : 'Choisir un CSV'}
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => choose(e.target.files[0])} />
        </label>
      </div>

      {busy && <div className="muted">Traitement…</div>}
      {error && <Banner kind="err">{error}</Banner>}

      {preview && (
        <div className="card card-pad" style={{ background: 'var(--card-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              Détecté : <strong>{KIND_LABEL[preview.kind] || preview.kind}</strong> · {preview.count} ligne(s)
              <span className="muted"> · délimiteur « {preview.delimiter === '\t' ? 'tab' : preview.delimiter} »</span>
            </div>
            <button className="btn" onClick={confirm} disabled={busy}>Confirmer l'import</button>
          </div>
        </div>
      )}

      {result && (
        <Banner kind="info">
          {result.kind === 'portfolio'
            ? `Portefeuille importé : ${result.positions} position(s)${result.replaced ? ', snapshot du jour remplacé' : ''}${result.deduplicated ? ' (déjà importé)' : ''}.`
            : `${KIND_LABEL[result.kind] || result.kind} : ${result.inserted} nouveau(x) mouvement(s) sur ${result.received}.`}
        </Banner>
      )}
    </div>
  );
}

export default function Settings({ onImported }) {
  const [tokenInput, setTokenInput] = useState('');
  const [enrichMsg, setEnrichMsg] = useState(null);
  const [theme, setThemeState] = useState(document.documentElement.getAttribute('data-theme') || 'auto');

  function applyTheme(t) {
    setThemeState(t);
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  const currentToken = getToken();
  const masked = currentToken ? `${currentToken.slice(0, 4)}…${currentToken.slice(-4)}` : '—';

  async function runEnrich() {
    setEnrichMsg({ kind: 'info', text: 'Enrichissement en cours…' });
    try {
      const res = await enrichNow();
      setEnrichMsg({ kind: 'info', text: `Enrichissement terminé : ${res.enriched ?? 0} ISIN traité(s), ${res.failed ?? 0} échec(s).` });
      onImported?.();
    } catch (e) {
      setEnrichMsg({ kind: 'err', text: e.status === 404 ? "Endpoint d'enrichissement pas encore disponible." : (e.body?.error || e.message) });
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 880 }}>
      <Card title="Importer un export DEGIRO">
        <p className="muted" style={{ marginTop: 0 }}>
          Exportez vos fichiers depuis DEGIRO puis déposez-les ici. Le type est détecté automatiquement ; une prévisualisation
          s'affiche avant l'import définitif.
        </p>
        <div className="grid" style={{ gap: 22 }}>
          <Uploader hint="auto" title="Portefeuille (positions)" description="Portfolio.csv — vos lignes actuelles" onImported={onImported} />
          <Uploader hint="auto" title="Relevé de compte" description="Account.csv — dépôts, dividendes, frais" onImported={onImported} />
          <Uploader hint="auto" title="Transactions" description="Transactions.csv — vos ordres exécutés" onImported={onImported} />
        </div>
      </Card>

      <Card title="Enrichissement ISIN">
        <p className="muted" style={{ marginTop: 0 }}>
          Complète secteur, pays et ticker de chaque position via des sources externes. Résultats mis en cache et corrigeables à la main.
        </p>
        <button className="btn" onClick={runEnrich}>Lancer l'enrichissement</button>
        {enrichMsg && <div style={{ marginTop: 12 }}><Banner kind={enrichMsg.kind}>{enrichMsg.text}</Banner></div>}
        <div style={{ marginTop: 18 }}>
          <div className="card-title">Références ISIN (correction manuelle)</div>
          <IsinEditor reloadKey={enrichMsg?.text} />
        </div>
      </Card>

      <Card title="Jeton d'accès">
        <p className="muted" style={{ marginTop: 0 }}>Jeton actuel : <code>{masked}</code></p>
        <div className="field" style={{ maxWidth: 480 }}>
          <label>Remplacer le jeton</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" type="password" placeholder="Nouveau jeton" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
            <button className="btn" disabled={!tokenInput} onClick={() => { setToken(tokenInput.trim()); location.reload(); }}>Enregistrer</button>
          </div>
        </div>
        <button className="link-btn" style={{ marginTop: 12 }} onClick={() => { clearToken(); location.reload(); }}>Se déconnecter (oublier le jeton)</button>
      </Card>

      <Card title="Apparence">
        <div style={{ display: 'flex', gap: 8 }}>
          {['auto', 'light', 'dark'].map((t) => (
            <button key={t} className={`btn ${theme === t ? '' : 'ghost'}`} onClick={() => applyTheme(t)}>
              {t === 'auto' ? 'Système' : t === 'light' ? 'Clair' : 'Sombre'}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
