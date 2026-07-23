/** Formate une Date en 'YYYY-MM-DD HH:MM:SS' UTC (pour stockage MySQL DATETIME). */
export function toMysqlUtc(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Jour civil (Europe/Paris) d'une Date, au format 'YYYY-MM-DD'. */
export function parisCivilDate(d) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
