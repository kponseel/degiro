/**
 * En-tête de colonne cliquable et accessible (aria-sort + bouton).
 * `cls` marque les colonnes secondaires (`col-opt`) : la classe doit atterrir
 * sur le <th> comme sur les <td>, sinon les colonnes se décalent dès que la
 * feuille de style les masque sur petit écran.
 */
export default function SortHeader({ label, colKey, sort, onToggle, align = 'right', cls = '' }) {
  const on = sort.key === colKey;
  const dir = on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th aria-sort={dir} scope="col" className={cls} style={{ textAlign: align }}>
      <button className={`th-sort ${on ? 'on' : ''}`} onClick={() => onToggle(colKey)}>
        {label}
        <span className="th-arrow" aria-hidden="true">{on ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}
