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
  auto: $('auto'), autoMsg: $('autoMsg'), openApp: $('openApp'), openAppWrap: $('openAppWrap'),
  force: $('force'),
};

/**
 * Instance par défaut. L'adresse était à saisir à la main alors qu'elle est la
 * même pour tout le monde — une étape de plus, et une occasion de se tromper.
 * Le champ reste modifiable pour une instance auto-hébergée.
 */
const ANALYZER_PAR_DEFAUT = 'https://degiro.estim.pro';

let lastReport = null;

function show(el, text) { el.textContent = text; el.hidden = !text; }

/** « 89 912,55 € » — DEGIRO livre ses totaux avec six décimales. */
const euros = (n) => (Number.isFinite(Number(n))
  ? `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
  : '— €');

// ── Réglages ────────────────────────────────────────────────────────
const stored = await chrome.storage.local.get(['apiUrl', 'token', 'brouillon', 'lastCapture', 'auto', 'lastAuto', 'lastAutoReport']);
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
const quand = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
if (stored.lastCapture) {
  els.last.textContent = `dernière capture ${quand(stored.lastCapture.at)}${stored.lastCapture.mode === 'auto' ? ' (auto)' : ''}`;
}

// ── Capture automatique ─────────────────────────────────────────────
els.auto.checked = stored.auto === true;
els.auto.addEventListener('change', async () => {
  await chrome.storage.local.set({ auto: els.auto.checked });
  show(els.autoMsg, els.auto.checked
    ? 'Activée : la prochaine ouverture de DEGIRO lancera la capture du jour, sans clic.'
    : 'Désactivée.');
});
// Une capture automatique ratée se signale par un « ! » sur l'icône : on en
// montre ici la raison et le diagnostic, puis le badge disparaît (c'est vu).
const autoFailedLast = Boolean(stored.lastAuto && !stored.lastAuto.ok
  && (!stored.lastCapture || new Date(stored.lastAuto.at) > new Date(stored.lastCapture.at)));
if (autoFailedLast) {
  show(els.autoMsg, `Dernière capture automatique échouée (${quand(stored.lastAuto.at)}) : ${stored.lastAuto.error || 'voir le diagnostic'}`);
  els.autoMsg.classList.add('err');
}
chrome.action.setBadgeText({ text: '' }).catch(() => {});
// Le rendu du diagnostic est défini plus bas : on le déclenche une fois la page prête.
const autoReportToShow = autoFailedLast ? stored.lastAutoReport : null;

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

async function lancerCapture(force = false) {
  els.capture.disabled = true;
  els.force.hidden = true;
  els.capture.textContent = 'Capture en cours…';
  show(els.error, ''); show(els.success, '');

  try {
    const res = await chrome.runtime.sendMessage({ type: 'CAPTURE', force });
    renderReport(res?.report);
    if (res?.ok) {
      const s = res.summary;
      show(els.success, s.deduplicated
        ? `Déjà à jour : ${s.positions} position(s), ${euros(s.total)}.`
        : `Envoyé : ${s.positions} position(s), ${euros(s.total)}.`);
      els.last.textContent = 'dernière capture à l’instant';
      try {
        els.openApp.href = `${new URL(els.apiUrl.value.trim() || ANALYZER_PAR_DEFAUT).origin}/#/overview`;
        els.openAppWrap.hidden = false;
      } catch { /* adresse invalide : pas de lien */ }
    } else {
      show(els.error, res?.error || 'Échec de la capture.');
      // Refusée par le garde-fou : l'utilisateur, qui connaît ses opérations,
      // peut confirmer. La capture est refaite, puis envoyée sans contrôle.
      els.force.hidden = !res?.suspect;
      els.diagBox.open = true;
    }
  } catch (e) {
    show(els.error, String(e.message || e));
  } finally {
    els.capture.disabled = false;
    els.capture.textContent = 'Capturer mon portefeuille';
  }
}

els.capture.addEventListener('click', () => lancerCapture(false));
els.force.addEventListener('click', () => lancerCapture(true));

els.copyDiag.addEventListener('click', async () => {
  const lines = (lastReport?.steps || []).map((s) => `${s.ok ? 'OK ' : 'KO '} ${s.label}${s.detail ? ` — ${s.detail}` : ''}`);
  await navigator.clipboard.writeText([`Diagnostic ${lastReport?.at || ''}`, ...lines].join('\n'));
  els.copyDiag.textContent = 'Copié ✓';
  setTimeout(() => { els.copyDiag.textContent = 'Copier le diagnostic'; }, 1800);
});

// Diagnostic de la dernière capture automatique ratée, pour voir l'étape fautive.
if (autoReportToShow?.steps?.length) renderReport(autoReportToShow);
