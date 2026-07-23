import { useEffect, useState } from 'react';
import { getIsinRef, updateIsinRef } from '../lib/api.js';

function Row({ item: r, onSaved }) {
  const [sector, setSector] = useState(r.sector || '');
  const [country, setCountry] = useState(r.country || '');
  const [state, setState] = useState('idle'); // idle | saving | saved

  const dirty = sector !== (r.sector || '') || country !== (r.country || '');

  async function save() {
    setState('saving');
    try {
      await updateIsinRef(r.isin, {
        sector: sector || null,
        country: country || null,
        asset_class: r.asset_class || null,
        ticker: r.ticker || null,
      });
      setState('saved');
      onSaved?.();
    } catch {
      setState('idle');
    }
  }

  return (
    <tr>
      <td><span className="sym">{r.name || r.isin}</span> <span className="muted">{r.isin}</span></td>
      <td><input className="input" style={{ minWidth: 110, width: 130 }} value={sector} onChange={(e) => { setSector(e.target.value); setState('idle'); }} placeholder="Secteur" /></td>
      <td><input className="input" style={{ minWidth: 90, width: 110 }} value={country} onChange={(e) => { setCountry(e.target.value); setState('idle'); }} placeholder="Pays" /></td>
      <td>{r.manual_override ? <span className="chip warn">manuel</span> : <span className="muted">auto</span>}</td>
      <td>
        <button className="btn ghost" disabled={!dirty || state === 'saving'} onClick={save}>
          {state === 'saving' ? '…' : state === 'saved' && !dirty ? '✓' : 'Enregistrer'}
        </button>
      </td>
    </tr>
  );
}

export default function IsinEditor({ reloadKey }) {
  const [refs, setRefs] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    getIsinRef().then((d) => setRefs(d.refs)).catch((e) => setError(e.message));
  }
  useEffect(load, [reloadKey]);

  if (error) return <div className="banner err">{error}</div>;
  if (!refs) return <div className="muted">Chargement…</div>;
  if (!refs.length) return <div className="muted">Importez d'abord un portefeuille pour éditer les références ISIN.</div>;

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr><th>Titre</th><th>Secteur</th><th>Pays</th><th>Source</th><th></th></tr>
        </thead>
        <tbody>
          {refs.map((r) => <Row key={r.isin} item={r} onSaved={load} />)}
        </tbody>
      </table>
    </div>
  );
}
