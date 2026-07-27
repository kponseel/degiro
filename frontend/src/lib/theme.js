/**
 * Thème de l'interface — logique pure, partagée par le démarrage (main.jsx),
 * la barre supérieure (App.jsx) et la carte « Apparence » (Réglages) ; elle y
 * était dupliquée trois fois, avec trois comportements légèrement différents.
 *
 * Trois valeurs seulement. 'auto' (le défaut) n'écrit AUCUN attribut et laisse
 * la feuille de styles suivre `prefers-color-scheme` ; 'light' / 'dark'
 * forcent via `data-theme`. Le défaut compte : forcer le clair au démarrage
 * servait un écran blanc éclatant à qui a son système en sombre, alors que le
 * thème sombre existe entièrement dans styles.css.
 */
export const THEME_KEY = 'degiro_theme';
export const THEMES = ['auto', 'light', 'dark'];

/** Choix mémorisé, assaini : une valeur inconnue ne doit pas figer un thème. */
export function readTheme(storage) {
  const saved = storage?.getItem?.(THEME_KEY);
  return THEMES.includes(saved) ? saved : 'auto';
}

/** Ce qui est réellement à l'écran, une fois 'auto' tranché par le système. */
export function resolveTheme(theme, systemDark) {
  if (theme === 'light' || theme === 'dark') return theme;
  return systemDark ? 'dark' : 'light';
}

/**
 * Bascule à partir du rendu VISIBLE, pas de la valeur mémorisée : depuis
 * 'auto' sur un système sombre, l'ancienne bascule écrivait 'dark' — rien ne
 * changeait à l'écran et le bouton semblait cassé.
 */
export function nextTheme(theme, systemDark) {
  return resolveTheme(theme, systemDark) === 'dark' ? 'light' : 'dark';
}

/** true si le système est en sombre ; false partout où matchMedia manque. */
export function systemPrefersDark() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Applique au document ; 'auto' retire l'attribut et rend la main à la CSS. */
export function applyTheme(theme, root = document.documentElement) {
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  return theme;
}

/** Mémorise puis applique — ce qu'appellent la barre et les Réglages. */
export function saveTheme(theme, { storage = localStorage, root = document.documentElement } = {}) {
  const next = THEMES.includes(theme) ? theme : 'auto';
  storage.setItem(THEME_KEY, next);
  return applyTheme(next, root);
}
