import { useEffect, useState } from 'react';
import { adminListUsers, adminUpdateUser, adminDeleteUser } from '../lib/api.js';
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