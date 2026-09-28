export function Spinner() {
  return (
    <div className="center">
      <div className="spinner" role="status" aria-label="Chargement" />
    </div>
  );
}

export function Card({ title, children, className = '' }) {
  return (
    <section className={`card card-pad ${className}`}>
      {title && <div className="card-title">{title}</div>}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${tone || ''}`}>{value}</div>
      {sub && <div className={`sub ${tone || ''}`}>{sub}</div>}
    </div>
  );
}

/**
 * Message d'information/alerte. Le contenu est enveloppé : `.banner` est en
 * `display: flex`, et sans cette enveloppe chaque <strong> du message devenait
 * un élément flex distinct — le texte se cassait alors en colonnes au lieu de
 * couler normalement.
 */
export function Banner({ kind = 'info', children }) {
  return (
    <div className={`banner ${kind}`}>
      <div className="banner-body">{children}</div>
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}

/**
 * Champ de recherche d'un tableau.
 *
 * Le bouton d'effacement évite d'avoir à sélectionner
 * le texte pour revenir à la liste complète — geste pénible au pouce.
 */
export function SearchInput({ value, onChange, placeholder = 'Rechercher…', label }) {
  return (
    <div className="search-input">
      <input
        type="search"
        className="filter-select"
        value={value}
        placeholder={placeholder}
        aria-label={label || placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" className="search-clear" onClick={() => onChange('')} aria-label="Effacer la recherche">
          ×
        </button>
      )}
    </div>
  );
}
