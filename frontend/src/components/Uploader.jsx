import { useState } from 'react';
import { uploadCsv } from '../lib/api.js';
import { Banner } from './ui.jsx';

const KIND_LABEL = { portfolio: 'Portefeuille', account: 'Relevé de compte', transactions: 'Transactions' };

/**
 * Dépôt d'un export DEGIRO : prévisualisation puis import.
 * Partagé entre Réglages et l'onboarding.
 * @param onImported  rafraîchit les pages après un commit réussi
 * @param onDone      callback(result) après un commit réussi (ex. aller à la Vue d'ensemble)
 */
export default function Uploader({ hint, title, description, onImported, onDone }) {
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
      onDone?.(res);
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

      {result && result.deduplicated && (
        <Banner kind="warn">
          Ce fichier avait <strong>déjà été importé</strong> — aucune nouvelle donnée. Pour mettre à jour,
          exporte un fichier plus récent depuis DEGIRO.
        </Banner>
      )}
      {result && !result.deduplicated && (
        <Banner kind="info">
          {result.kind === 'portfolio'
            ? `Portefeuille importé : ${result.positions} position(s)${result.replaced ? ', snapshot du jour remplacé' : ''}.`
            : `${KIND_LABEL[result.kind] || result.kind} : ${result.inserted} nouveau(x) mouvement(s) sur ${result.received}.`}
        </Banner>
      )}
    </div>
  );
}