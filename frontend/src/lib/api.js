function qs(obj) {
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'include', ...opts });
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

const jsonPost = (path, data, method = 'POST') =>
  api(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });

// ── Authentification (lien magique + session cookie) ──────────────
export const requestMagicLink = (email, pseudo) => jsonPost('/api/auth/request-link', { email, pseudo });
export const verifyMagicLink = (token) => jsonPost('/api/auth/verify', { token });
export const getMe = () => api('/api/auth/me');
export const logout = () => jsonPost('/api/auth/logout', {});
export const updatePseudo = (pseudo) => jsonPost('/api/auth/me', { pseudo }, 'PATCH');
export const deleteMyData = () => api('/api/auth/me/data', { method: 'DELETE' });
export const deleteAccount = () => api('/api/auth/me', { method: 'DELETE' });

// ── Administration (ADMIN_EMAIL uniquement) ───────────────────────
export const adminListUsers = () => api('/api/admin/users');
export const adminUpdateUser = (id, patch) => jsonPost(`/api/admin/users/${id}`, patch, 'PATCH');
export const adminDeleteUser = (id) => api(`/api/admin/users/${id}`, { method: 'DELETE' });

// ── Données ───────────────────────────────────────────────────────
export const getPortfolio = () => api('/api/portfolio');
export const getSnapshots = (from, to) => api(`/api/snapshots${qs({ from, to })}`);
export const getExposure = (lookthrough) => api(`/api/exposure${qs({ lookthrough: lookthrough ? 1 : undefined })}`);
export const getRisk = () => api('/api/risk');
export const getDividends = () => api('/api/dividends');
export const getPerformance = () => api('/api/performance');
export const getIsinRef = () => api('/api/isin-ref');
export const updateIsinRef = (isin, patch) => jsonPost(`/api/isin-ref/${isin}`, patch, 'PUT');
export const enrichNow = () => api('/api/enrich', { method: 'POST' });
export const getLookthrough = () => api('/api/lookthrough');
export const getEtfHoldings = () => api('/api/etf-holdings');
export const getBenchmark = (symbol) => api(`/api/benchmark${qs({ symbol })}`);

async function uploadForm(path, fd) {
  const res = await fetch(path, { method: 'POST', credentials: 'include', body: fd });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export function uploadEtfHoldings(file, etfIsin, mode = 'commit') {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('etf_isin', etfIsin);
  fd.append('mode', mode);
  return uploadForm('/api/etf-holdings', fd);
}

export function uploadCsv(file, kind, mode) {
  const fd = new FormData();
  fd.append('file', file);
  if (kind && kind !== 'auto') fd.append('kind', kind);
  fd.append('mode', mode);
  return uploadForm('/api/ingest/csv', fd);
}
