const TOKEN_KEY = 'degiro_api_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

function qs(obj) {
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((body && body.error) || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const getPortfolio = () => api('/api/portfolio');
export const getSnapshots = (from, to) => api(`/api/snapshots${qs({ from, to })}`);
export const getExposure = (lookthrough) => api(`/api/exposure${qs({ lookthrough: lookthrough ? 1 : undefined })}`);
export const getRisk = () => api('/api/risk');
export const getDividends = () => api('/api/dividends');
export const getPerformance = () => api('/api/performance');
export const getIsinRef = () => api('/api/isin-ref');
export const updateIsinRef = (isin, patch) =>
  api(`/api/isin-ref/${isin}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
export const enrichNow = () => api('/api/enrich', { method: 'POST' });
export const getLookthrough = () => api('/api/lookthrough');
export const getEtfHoldings = () => api('/api/etf-holdings');

export async function uploadEtfHoldings(file, etfIsin, mode = 'commit') {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('etf_isin', etfIsin);
  fd.append('mode', mode);
  const token = getToken();
  const res = await fetch('/api/etf-holdings', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function uploadCsv(file, kind, mode) {
  const fd = new FormData();
  fd.append('file', file);
  if (kind && kind !== 'auto') fd.append('kind', kind);
  fd.append('mode', mode);
  const token = getToken();
  const res = await fetch('/api/ingest/csv', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Vérifie qu'un jeton est accepté par le backend (endpoint authentifié). */
export async function validateToken(token) {
  const res = await fetch('/api/portfolio', { headers: { Authorization: `Bearer ${token}` } });
  return res.status !== 401;
}
