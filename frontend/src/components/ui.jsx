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
 * Sous-navigation d'une page trop riche pour un seul écran.
 *
 * La page Performance empilait graphiques, tableaux et listes sur plusieurs
 * milliers de pixels : atteindre les dividendes demandait de traverser tout
 * l'historique des ventes. Les sections deviennent des onglets — le bandeau de
 * chiffres reste au-dessus, comme point fixe.
 *
 * Défilable horizontalement sur téléphone plutôt que replié sur deux lignes :
 * quatre onglets empilés mangeraient l'écran qu'on cherche à libérer.
 */
export function SubTabs({ value, onChange, items, label = 'Sections' }) {
  return (
    <div className="subtabs" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          id={`subtab-${it.id}`}
          aria-selected={value === it.id}
          aria-controls={`panel-${it.id}`}
          className={`subtab ${value === it.id ? 'on' : ''}`}
          onClick={() => onChange(it.id)}
        >
          {it.label}
          {it.count != null && <span className="subtab-count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Panneau associé à un onglet de `SubTabs`.
 *
 * `cache` MASQUE au lieu de démonter : l'appelant garde ainsi ses panneaux
 * montés, et avec eux les filtres, tris, pages et recherches que l'utilisateur
 * vient de régler. L'attribut `hidden` les retire aussi de l'ordre de tabulation
 * et des lecteurs d'écran — un simple `display: none` en CSS ne suffirait pas à
 * empêcher le clavier d'entrer dans un panneau invisible.
 */
export function SubPanel({ id, children, cache = false }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`subtab-${id}`} hidden={cache}>
      {children}
    </div>
  );
}

/**
 * Champ de recherche d'un tableau.
 *
 * Sur un historique long, filtrer par année ne suffit pas : on cherche un titre
 * précis, pas une période. Le bouton d'effacement évite d'avoir à sélectionner
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

/**
 * Barre de pagination.
 *
 * Toujours accompagnée du décompte : « 1–25 sur 348 ventes » dit du même coup
 * où l'on est et combien il reste, là où des flèches nues laissent croire à une
 * liste tronquée sans fin.
 */
export function Pager({
  page, pages, total, debut, taille, onPage, onTaille, tailles = [25, 50, 100], libelle = 'ligne',
}) {
  if (!total) return null;
  const fin = Math.min(debut + taille, total);
  const nom = Math.abs(total) >= 2 ? `${libelle}s` : libelle;
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="pager-info">
        {debut + 1}–{fin} sur {new Intl.NumberFormat('fr-FR').format(total)} {nom}
      </span>
      {pages > 1 && (
        <div className="pager-btns">
          <button type="button" className="btn ghost pager-btn" disabled={page <= 1}
            onClick={() => onPage(page - 1)} aria-label="Page précédente">‹</button>
          <span className="pager-page" aria-live="polite">{page} / {pages}</span>
          <button type="button" className="btn ghost pager-btn" disabled={page >= pages}
            onClick={() => onPage(page + 1)} aria-label="Page suivante">›</button>
        </div>
      )}
      {onTaille && total > tailles[0] && (
        <select
          className="filter-select pager-size"
          value={taille}
          aria-label="Lignes par page"
          onChange={(e) => onTaille(Number(e.target.value))}
        >
          {tailles.map((n) => <option key={n} value={n}>{n} par page</option>)}
        </select>
      )}
    </nav>
  );
}
