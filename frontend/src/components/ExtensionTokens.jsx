import { useEffect, useState } from 'react';
import { listExtTokens, createExtToken, revokeExtToken } from '../lib/api.js';
import { Card, Banner } from './ui.jsx';
import { fmtDate, fmtNum } from '../lib/format.js';

/**
 * Jetons d'extension : chaque utilisateur génère le sien pour que l'extension
 * Chrome puisse envoyer ses captures. Le jeton en clair n'est affiché qu'une
 * seule fois, à la création (seul son hash est conservé côté serveur).
 */
export default function ExtensionTokens() {
  const [tokens, setTokens] = useState(null);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState(null); // jeton en clair, montré une fois
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  // L'adresse que l'extension réclame : l'origine d'où cette page est servie.
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  function load() {
    listExtTokens().then((d) => setTokens(d.tokens || [])).catch((e) => setError(e.body?.error || e.message));
  }
  useEffect(load, []);

  async function create() {
    setBusy(true); setError(null);
    try {
      const res = await createExtToken(label.trim() || undefined);
      setFresh(res.token);
      setCopied(false);
      setLabel('');
      load();
    } catch (e) {
      setError(e.body?.error || e.message);
    } finally { setBusy(false); }
  }

  async function revoke(id) {
    setBusy(true);
    try {
      await revokeExtToken(id);
      setConfirmId(null);
      load();
    } catch (e) {
      setError(e.body?.error || e.message);
    } finally { setBusy(false); }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* presse-papiers indisponible : le jeton reste affiché */ }
  }

  return (
    <Card title="Extension Chrome — capture en un clic">
      <p className="muted" style={{ marginTop: 0 }}>
        L'extension capture ton portefeuille depuis ta session DEGIRO ouverte, sans fichier à manipuler.
        Trois étapes : <strong>1.</strong> installe-la, <strong>2.</strong> génère un jeton, <strong>3.</strong> colle-le dans l'extension.
      </p>

      <div className="ext-step">
        <div className="ext-step-head">
          <span className="ext-step-num">1</span>
          <strong>Installer l'extension</strong>
        </div>
        <p className="muted" style={{ margin: '2px 0 10px' }}>
          Sur ordinateur (Chrome / Edge / Brave). Pas disponible sur mobile — sur téléphone, importe plutôt un CSV.
        </p>
        <a className="btn" href="/api/extension/download" download>⬇ Télécharger l'extension (.zip)</a>

        <details className="ext-help">
          <summary>Instructions d'installation (Windows / Mac)</summary>
          <ol className="ext-instr">
            <li><strong>Décompresse le .zip</strong> téléchargé.
              <div className="muted">Windows : clic droit → <em>Extraire tout</em>. Mac : double-clic sur le fichier.</div>
              <div className="muted">Tu obtiens un dossier <code>degiro-analyzer</code> — retiens où il est (Téléchargements, en général).</div>
            </li>
            <li>Ouvre Chrome et va à l'adresse <code>chrome://extensions</code>.</li>
            <li>Active le <strong>Mode développeur</strong> (interrupteur en haut à droite).</li>
            <li>Clique <strong>« Charger l'extension non empaquetée »</strong> (Windows) / <strong>« Load unpacked »</strong> si Chrome est en anglais.</li>
            <li>Sélectionne le dossier <code>degiro-analyzer</code> décompressé à l'étape 1.
              <div className="muted">Choisis le dossier lui-même, pas un fichier à l'intérieur.</div>
            </li>
            <li>L'icône de l'extension apparaît dans la barre d'outils. C'est prêt — passe au jeton ci-dessous.</li>
          </ol>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Le dossier doit rester à sa place : Chrome le lit à chaque démarrage. Ne le supprime pas après installation.
          </p>
        </details>
      </div>

      <div className="ext-step-head" style={{ marginTop: 18 }}>
        <span className="ext-step-num">2</span>
        <strong>Générer un jeton</strong>
      </div>
      <p className="muted" style={{ marginTop: 2 }}>
        Le jeton relie l'extension à ton compte. Il n'est affiché <strong>qu'une seule fois</strong> —
        si tu le perds, révoque-le et génère-en un nouveau.
      </p>

      {fresh && (
        <div className="banner warn" style={{ display: 'block', marginBottom: 14 }}>
          <strong>Copie ce jeton maintenant</strong> — il ne sera plus jamais affiché.
          <div className="token-reveal">
            <code>{fresh}</code>
            <button className="btn" style={{ padding: '5px 12px', fontSize: 13 }} onClick={copy}>
              {copied ? 'Copié ✓' : 'Copier'}
            </button>
          </div>
          <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setFresh(null)}>J'ai copié, masquer</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Nom (ex. Chrome portable)"
          aria-label="Nom du jeton"
        />
        <button className="btn" onClick={create} disabled={busy}>Générer un jeton</button>
      </div>

      {error && <div style={{ marginTop: 12 }}><Banner kind="err">{error}</Banner></div>}

      {tokens && tokens.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="data compact">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Nom</th>
                <th style={{ textAlign: 'left' }}>Début</th>
                <th>Créé le</th>
                <th>Dernier usage</th>
                <th>Envois</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.label}</td>
                  <td><code className="muted">{t.prefix}…</code></td>
                  <td>{fmtDate(t.created_at)}</td>
                  <td>{t.last_used_at ? fmtDate(t.last_used_at) : <span className="muted">jamais</span>}</td>
                  <td>{fmtNum(t.uses, 0)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {confirmId === t.id
                      ? <button className="btn danger" style={{ padding: '5px 11px', fontSize: 13 }} disabled={busy} onClick={() => revoke(t.id)}>Confirmer ⚠</button>
                      : <button className="btn ghost" style={{ padding: '5px 11px', fontSize: 13 }} onClick={() => setConfirmId(t.id)}>Révoquer</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tokens && tokens.length === 0 && (
        <div className="muted" style={{ marginTop: 12, fontSize: 13 }}>Aucun jeton pour l'instant.</div>
      )}

      {/* Étape 3 : l'extension réclame l'adresse de l'instance, que l'application
          connaît. La faire deviner ne servait à rien — on la donne, prête à copier. */}
      <div className="ext-step-head" style={{ marginTop: 22 }}>
        <span className="ext-step-num">3</span>
        <strong>Coller dans l'extension</strong>
      </div>
      <p className="muted" style={{ marginTop: 2 }}>
        Clique sur l'icône de l'extension dans Chrome, puis renseigne ces deux champs
        et valide par <strong>Enregistrer</strong>. Chrome demandera l'autorisation
        d'appeler ce serveur&nbsp;: accepte, sinon l'envoi ne peut pas fonctionner.
      </p>

      <div className="field" style={{ maxWidth: 420, marginTop: 10 }}>
        <label htmlFor="ext-origin">« Adresse de ton Analyzer » — à copier tel quel</label>
        <div className="token-reveal">
          <code id="ext-origin">{origin}</code>
          <button
            className="btn"
            style={{ padding: '5px 12px', fontSize: 13 }}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(origin);
                setCopiedUrl(true);
                setTimeout(() => setCopiedUrl(false), 1800);
              } catch { /* presse-papiers refusé : l'adresse reste sélectionnable */ }
            }}
          >
            {copiedUrl ? 'Copié ✓' : 'Copier'}
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
        « Jeton d'extension »&nbsp;: celui généré à l'étape 2, qui commence par <code>dgx_</code>.
      </p>
    </Card>
  );
}
