/** En-tête de colonne cliquable et accessible (aria-sort + bouton). */
export default function SortHeader({ label, colKey, sort, onToggle, align = 'right' }) {
  const on = sort.key === colKey;
  const dir = on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th aria-sort={dir} scope="col" style={{ textAlign: align }}>
      <button className={`th-sort ${on ? 'on' : ''}`} onClick={() => onToggle(colKey)}>
        {label}
        <span className="th-arrow" aria-hidden="true">{on ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}
