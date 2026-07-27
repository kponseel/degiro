import { useEffect, useState } from 'react';
import { adminListUsers, adminUpdateUser, adminDeleteUser, adminGetInviteCode, adminSetInviteCode } from '../lib/api.js';
import { fmtDate, fmtNum } from '../lib/format.js';
import { Spinner, Card, Banner, Stat } from '../components/ui.jsx';

function UserRow({ u, isSelf, onSaved, onDeleted, onError }) {
  const [email, setEmail] = useState(u.email);
  const [pseudo, setPseudo] = useState(u.pseudo);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = email.trim() !== u.email || pseudo.trim() !== u.pseudo;

  async function save() {
    setBusy(true);
    try {
      const patch = {};
      if (email.trim() !== u.email) patch.email = email.trim();
      if (pseudo.trim() !== u.pseudo) patch.pseudo = pseudo.trim();
      await adminUpdateUser(u.id, patch);
      onSaved();
    } catch (e) {
      onError(e.body?.error || e.message);
      setEmail(u.email);
      setPseudo(u.pseudo);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await adminDeleteUser(u.id);
      onDeleted();
    } catch (e) {
      onError(e.body?.error || e.message);
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <tr>
      <td className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>#{u.id}</td>
      <td>
        <input className="input" style={{ width: 130, padding: '7px 10px', fontSize: 13.5 }} value={pseudo}
          maxLength={60} onChange={(e) => setPseudo(e.target.value)} />
      </td>
      <td>
        <input className="input" style={{ width: 200, padding: '7px 10px', fontSize: 13.5 }} value={email}
          type="email" onChange={(e) => setEmail(e.target.value)} />
        {isSelf && <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>toi (admin)</div>}
      </td>
      <td style={{ fontSize: 13 }}>{fmtDate(u.created_at)}</td>
      <td style={{ fontSize: 13 }}>{u.last_login_at ? fmtDate(u.last_login_at) : '—'}</td>
      <td>{fmtNum(u.login_count, 0)}</td>
      <td style={{ fontSize: 13 }}>
        {fmtNum(u.snapshots, 0)} snap · {fmtNum(u.transactions, 0)} mvt
        {u.active_sessions > 0 && <div className="muted" style={{ fontSize: 11.5 }}>{u.active_sessions} session(s)</div>}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button className="btn" style={{ padding: '6px 12px', fontSize: 13 }} disabled={!dirty || busy} onClick={save}>
          Enregistrer
        </button>{' '}
        {!isSelf && (confirmDelete
          ? <button className="btn danger" style={{ padding: '6px 12px', fontSize: 13 }} disabled={busy} onClick={remove}>Confirmer ⚠</button>
          : <button className="btn ghost" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setConfirmDelete(true)}>Supprimer</button>)}
      </td>
    </tr>
  );
}


/**
 * Code d'invitation exigé pour créer un compte.
 *
 * Modifiable ici plutôt que par variable d'environnement : le changer ne doit
 * demander ni redéploiement ni passage par l'hébergeur. Le code est affiché en
 * clair — c'est un code de partage, destiné à être communiqué, pas un secret
 * personnel.
 */
function InviteCodeCard() {
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | saving
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    adminGetInviteCode()
      .then((d) => { setCode(d.code || ''); setSaved(d.code); setState('ready'); })
      .catch((e) => { setMsg({ kind: 'err', text: e.message }); setState('ready'); });
  }, []);

  async function save() {
    setState('saving');
    setMsg(null);
    try {
      const d = await adminSetInviteCode(code.trim());
      setSaved(d.code);
      setCode(d.code || '');
      setMsg(d.open
        ? { kind: 'warn', text: 'Code retiré : n’importe qui peut désormais créer un compte.' }
        : { kind: 'ok', text: 'Code enregistré. Il s’applique immédiatement.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setState('ready');
    }
  }

  const dirty = code.trim() !== (saved || '');

  return (
    <Card title="Code d'invitation">
      <p className="muted" style={{ marginTop: 0 }}>
        Exigé pour <strong>créer</strong> un compte. Les personnes déjà inscrites se connectent
        sans lui — changer le code ne coupe donc l’accès à personne.
      </p>

      {state === 'loading' ? <Spinner /> : (
        <>
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="invite-code">Code actuel</label>
            <input
              id="invite-code"
              className="input"
              value={code}
              maxLength={255}
              autoComplete="off"
              onChange={(e) => setCode(e.target.value)}
              placeholder="Vide = inscription ouverte à tous"
            />
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={save} disabled={!dirty || state === 'saving'}>
              {state === 'saving' ? 'Enregistrement…' : 'Enregistrer le code'}
            </button>
            {saved === null && (
              <span className="muted" style={{ fontSize: 13 }}>
                Aucun code : l’inscription est ouverte à tout internet.
              </span>
            )}
          </div>

          {msg && (
            <div style={{ marginTop: 14 }}>
              <Banner kind={msg.kind === 'ok' ? 'info' : msg.kind}>{msg.text}</Banner>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default function Admin({ user }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  function load() {
    adminListUsers().then((d) => setUsers(d.users)).catch((e) => setError(e.body?.error || e.message));
  }
  useEffect(load, []);

  if (error && !users) return <Banner kind="err">{error}</Banner>;
  if (!users) return <Spinner />;

  const totalLogins = users.reduce((s, u) => s + (u.login_count || 0), 0);
  const activeNow = users.filter((u) => u.active_sessions > 0).length;

  return (
    <>
      <div className="grid stat-row">
        <Stat label="Inscrits" value={fmtNum(users.length, 0)} />
        <Stat label="Connexions cumulées" value={fmtNum(totalLogins, 0)} />
        <Stat label="Sessions actives" value={fmtNum(activeNow, 0)} sub="utilisateurs avec une session ouverte" />
      </div>

      {notice && <div style={{ marginBottom: 14 }}><Banner kind="err">{notice}</Banner></div>}

      <InviteCodeCard />

      <Card title="Utilisateurs">
        <p className="muted" style={{ marginTop: 0 }}>
          Modifie l'email ou le pseudo directement dans le tableau puis <strong>Enregistrer</strong>.
          La suppression efface le compte, ses données et ses sessions — définitif.
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Id</th><th>Pseudo</th><th>Email</th><th>Inscrit le</th>
                <th>Dernière connexion</th><th>Connexions</th><th>Données</th><th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  u={u}
                  isSelf={u.id === user?.id}
                  onSaved={() => { setNotice(null); load(); }}
                  onDeleted={() => { setNotice(null); load(); }}
                  onError={(msg) => setNotice(msg)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}