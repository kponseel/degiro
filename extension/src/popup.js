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
  pin: $('pin'), tokenLink: $('tokenLink'),
};

/**
 * Instance par défaut. L'adresse était à saisir à la main alors qu'elle est la
 * même pour tout le monde — une étape de plus, et une occasion de se tromper.
 * Le champ reste modifiable pour une instance auto-hébergée.
 */
const ANALYZER_PAR_DEFAUT = 'https://degiro.estim.pro';

let lastReport = null;

function show(el, text) { el.textContent = text; el.hidden = !text; }

// ── Réglages ────────────────────────────────────────────────────────
const stored = await chrome.storage.local.get(['apiUrl', 'token', 'brouillon', 'lastCapture']);
// `brouillon` : ce qui a été tapé sans être enregistré. Le popup se ferme dès
// que Chrome perd le focus — typiquement en allant chercher son jeton — et la
// saisie en cours était alors perdue à chaque fois.
els.apiUrl.value = stored.apiUrl || stored.brouillon?.apiUrl || ANALYZER_PAR_DEFAUT;
els.token.value = stored.token || stored.brouillon?.token || '';

// Les jetons se génèrent sur la page « Import / Extension » de l'Analyzer.
const lienReglages = () => {
  try {
    return `${new URL(els.apiUrl.value.trim() || ANALYZER_PAR_DEFAUT).origin}/#/import`;
  } catch {
    return `${ANALYZER_PAR_DEFAUT}/#/import`;
  }
};
els.tokenLink.href = lienReglages();

// Mémorisation au fil de la frappe : rien n'est perdu si la fenêtre se ferme.
let minuteur;
for (const champ of [els.apiUrl, els.token]) {
  champ.addEventListener('input', () => {
    els.tokenLink.href = lienReglages();
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      chrome.storage.local.set({
        brouillon: { apiUrl: els.apiUrl.value.trim(), token: els.token.value.trim() },
      });
    }, 250);
  });
}

// Mode onglet : même page, mais elle ne se referme plus au moindre clic ailleurs.
if (new URLSearchParams(location.search).has('tab')) document.body.classList.add('in-tab');

els.pin.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/popup.html?tab=1') });
  window.close();
});
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
  await chrome.storage.local.remove('brouillon');
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
      const tx = s.transactions ? `, ${s.transactions} ordre(s)` : '';
      // Les mouvements du relevé (dividendes, versements) sont comptés à part :
      // ils débloquent la performance réelle et les dividendes, et le dire
      // montre que l'export manuel d'un Account.csv n'est plus nécessaire.
      const mv = s.movements ? `, ${s.movements} mouvement(s)` : '';
      show(els.success, s.deduplicated
        ? `Déjà à jour : ${s.positions} position(s)${tx}${mv}, ${s.total} €.`
        : `Envoyé : ${s.positions} position(s)${tx}${mv}, ${s.total} €.`);
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
