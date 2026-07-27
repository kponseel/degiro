function qs(obj) {
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Message lisible pour un échec. Sans cela, l'interface affichait tel quel ce
 * que renvoyait le navigateur ou le proxy — « Failed to fetch », « Bad Gateway » —
 * en anglais et sans indiquer quoi faire.
 */
function humanMessage(status, body) {
  // Le 401 passe AVANT le message du serveur : celui-ci vaut « Non authentifié »,
  // qui laissait l'utilisateur devant une erreur technique sans issue sur chaque
  // page. Le message métier a ici plus de valeur que celui de l'API.
  if (status === 401) return 'Ta session a expiré. Reconnecte-toi pour continuer.';
  if (body && typeof body === 'object' && body.error) return body.error;
  if (status === 0) return 'Connexion au serveur impossible. Vérifie ta connexion internet, puis réessaie.';
  if (status === 429) return 'Trop de requêtes d’affilée. Patiente un instant, puis réessaie.';
  if (status === 502 || status === 503 || status === 504) return 'Le service est momentanément indisponible. Réessaie dans un instant.';
  if (status >= 500) return 'Une erreur est survenue côté serveur. Réessaie dans un instant.';
  return 'La requête a échoué.';
}

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, { credentials: 'include', ...opts });
  } catch (cause) {
    // Réseau coupé, serveur injoignable, requête interrompue : `fetch` rejette
    // sans réponse. `status = 0` distingue ce cas d'une réponse HTTP en erreur.
    const err = new Error(humanMessage(0));
    err.status = 0;
    err.cause = cause;
    throw err;
  }

  const ct = res.headers.get('content-type') || '';
  // Une passerelle en panne répond en HTML : ne pas tenter de le lire en JSON.
  const body = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const err = new Error(humanMessage(res.status, body));
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

// ── Jetons d'extension (par utilisateur) ──────────────────────────
export const listExtTokens = () => api('/api/auth/me/tokens');
export const createExtToken = (label) => jsonPost('/api/auth/me/tokens', { label });
export const revokeExtToken = (id) => api(`/api/auth/me/tokens/${id}`, { method: 'DELETE' });

// ── Avis IA (prompts historisés + réponses ré-ingérées) ───────────
export const listAiPrompts = () => api('/api/ai/prompts');
export const saveAiPrompt = (p) => jsonPost('/api/ai/prompts', p);
export const deleteAiPrompt = (id) => api(`/api/ai/prompts/${id}`, { method: 'DELETE' });
export const listAiInsights = () => api('/api/ai/insights');
export const ingestAiInsight = (raw, provider) => jsonPost('/api/ai/insights', { raw, provider });
export const deleteAiInsight = (id) => api(`/api/ai/insights/${id}`, { method: 'DELETE' });

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
export const getAnalytics = () => api('/api/analytics');
export const getIsinRef = () => api('/api/isin-ref');
export const updateIsinRef = (isin, patch) => jsonPost(`/api/isin-ref/${isin}`, patch, 'PUT');
export const enrichNow = () => api('/api/enrich', { method: 'POST' });
export const getLookthrough = () => api('/api/lookthrough');
export const getEtfHoldings = () => api('/api/etf-holdings');
export const getBenchmark = (symbol) => api(`/api/benchmark${qs({ symbol })}`);
export const getNews = (symbol, refresh) => api(`/api/news${qs({ symbol, refresh: refresh ? 1 : undefined })}`);

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
