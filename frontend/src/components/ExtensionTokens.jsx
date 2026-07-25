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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

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
    <Card title="Extension Chrome — jetons d'accès">
      <p className="muted" style={{ marginTop: 0 }}>
        L'extension de capture automatique a besoin d'un jeton pour envoyer tes positions.
        Génères-en un, colle-le dans l'extension. Il n'est affiché <strong>qu'une seule fois</strong> —
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
    </Card>
  );
}
