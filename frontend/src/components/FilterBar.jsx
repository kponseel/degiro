/**
 * Barre de filtres réutilisable : recherche texte + facettes (listes déroulantes).
 * @param q        valeur de recherche
 * @param onQ      setter de recherche
 * @param facets   [{ key, label, value, options:[string], onChange }]
 * @param onReset  réinitialise tout
 * @param count    nombre d'éléments après filtrage
 * @param total    nombre total
 * @param placeholder placeholder du champ de recherche
 */
export default function FilterBar({ q, onQ, facets = [], onReset, count, total, placeholder = 'Rechercher…' }) {
  const active = Boolean(q) || facets.some((f) => f.value);
  return (
    <div className="filter-bar">
      <input
        className="input filter-search"
        type="search"
        value={q}
        onChange={(e) => onQ(e.target.value)}
        placeholder={placeholder}
        aria-label="Recherche"
      />
      {facets.map((f) => (
        <select
          key={f.key}
          className="input filter-select"
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
          aria-label={f.label}
        >
          <option value="">{f.label} : tous</option>
          {f.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ))}
      <div className="filter-meta">
        <span className="muted">{count}{total != null ? ` / ${total}` : ''}</span>
        {active && (
          <button className="link-btn" onClick={onReset}>Réinitialiser</button>
        )}
      </div>
    </div>
  );
}
