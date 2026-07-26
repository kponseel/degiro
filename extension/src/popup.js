/**
 * Popup : réglages, déclenchement de la capture, panneau de diagnostic.
 *
 * Le diagnostic n'est pas un détail : l'API DEGIRO n'est pas publique et peut
 * changer sans préavis. Quand ça casse, ce panneau dit à quelle étape — ce qui
 * évite de deviner.
 */
const $ = (id) => document.getElementById(id);

const els = {
  apiUrl: $('apiUrl'), token: $('token'), save: $('save'), saveMsg: $('saveMsg'),
  capture: $('capture'), error: $('error'), success: $('success'),
  diagBox: $('diagBox'), steps: $('steps'), copyDiag: $('copyDiag'), last: $('last'),
};

let lastReport = null;

function show(el, text) { el.textContent = text; el.hidden = !text; }

// ── Réglages ────────────────────────────────────────────────────────
const stored = await chrome.storage.local.get(['apiUrl', 'token', 'lastCapture']);
els.apiUrl.value = stored.apiUrl || '';
els.token.value = stored.token || '';
if (stored.lastCapture) {
  const d = new Date(stored.lastCapture.at);
  els.last.textContent = `dernière capture ${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

els.save.addEventListener('click', async () => {
  const apiUrl = els.apiUrl.value.trim().replace(/\/+$/, '');
  const token = els.token.value.trim();
  show(els.saveMsg, '');
  els.saveMsg.className = 'msg';

  if (!/^https?:\/\/.+/.test(apiUrl)) {
    els.saveMsg.className = 'msg err';
    return show(els.saveMsg, "Adresse invalide : commence par https:// (ou http:// en local).");
  }
  if (!token.startsWith('dgx_')) {
    els.saveMsg.className = 'msg err';
    return show(els.saveMsg, 'Le jeton doit commencer par « dgx_ ».');
  }

  // L'autorisation d'appeler ce serveur est demandée maintenant, sur ce clic :
  // Chrome exige un geste utilisateur, et ça évite de réclamer « tous les sites »
  // à l'installation.
  const origin = `${new URL(apiUrl).origin}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  if (!granted) {
    els.saveMsg.className = 'msg err';
    return show(els.saveMsg, `Autorisation refusée pour ${origin} — l'envoi ne peut pas fonctionner sans.`);
  }

  await chrome.storage.local.set({ apiUrl, token });
  els.saveMsg.className = 'msg ok';
  return show(els.saveMsg, 'Réglages enregistrés.');
});

// ── Capture ─────────────────────────────────────────────────────────
function renderReport(report) {
  lastReport = report;
  els.steps.replaceChildren();
  for (const s of report?.steps || []) {
    const li = document.createElement('li');
    const mark = document.createElement('span');
    mark.className = `mark ${s.ok ? 'ok' : 'ko'}`;
    mark.textContent = s.ok ? '✓' : '✗';
    const body = document.createElement('span');
    body.textContent = s.label;
    if (s.detail) {
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = s.detail;
      body.appendChild(detail);
    }
    li.append(mark, body);
    els.steps.appendChild(li);
  }
  els.diagBox.hidden = !(report?.steps || []).length;
}

els.capture.addEventListener('click', async () => {
  els.capture.disabled = true;
  els.capture.textContent = 'Capture en cours…';
  show(els.error, ''); show(els.success, '');

  try {
    const res = await chrome.runtime.sendMessage({ type: 'CAPTURE' });
    renderReport(res?.report);
    if (res?.ok) {
      const s = res.summary;
      const tx = s.transactions ? `, ${s.transactions} transaction(s)` : '';
      show(els.success, s.deduplicated
        ? `Déjà à jour : ${s.positions} position(s)${tx}, ${s.total} €.`
        : `Envoyé : ${s.positions} position(s)${tx}, ${s.total} €.`);
      els.last.textContent = 'dernière capture à l’instant';
    } else {
      show(els.error, res?.error || 'Échec de la capture.');
      els.diagBox.open = true;
    }
  } catch (e) {
    show(els.error, String(e.message || e));
  } finally {
    els.capture.disabled = false;
    els.capture.textContent = 'Capturer mon portefeuille';
  }
});

els.copyDiag.addEventListener('click', async () => {
  const lines = (lastReport?.steps || []).map((s) => `${s.ok ? 'OK ' : 'KO '} ${s.label}${s.detail ? ` — ${s.detail}` : ''}`);
  await navigator.clipboard.writeText([`Diagnostic ${lastReport?.at || ''}`, ...lines].join('\n'));
  els.copyDiag.textContent = 'Copié ✓';
  setTimeout(() => { els.copyDiag.textContent = 'Copier le diagnostic'; }, 1800);
});
