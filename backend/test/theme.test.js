import { describe, it, expect } from 'vitest';
import {
  THEME_KEY, readTheme, resolveTheme, nextTheme, applyTheme, saveTheme,
} from '../../frontend/src/lib/theme.js';

// Doublures minimales : le module ne doit dépendre ni d'un vrai localStorage
// ni d'un vrai DOM, sans quoi il ne serait testable que dans un navigateur.
const fakeStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
};
const fakeRoot = () => {
  const a = new Map();
  return {
    setAttribute: (k, v) => a.set(k, v),
    removeAttribute: (k) => a.delete(k),
    getAttribute: (k) => (a.has(k) ? a.get(k) : null),
  };
};

describe('Thème — choix mémorisé', () => {
  it('vaut « auto » tant que rien n’a été choisi', () => {
    // Régression : le démarrage forçait 'light', servant un écran blanc
    // éclatant à qui a son système en sombre.
    expect(readTheme(fakeStorage())).toBe('auto');
  });

  it('ignore une valeur corrompue plutôt que de l’appliquer', () => {
    expect(readTheme(fakeStorage({ [THEME_KEY]: 'néon' }))).toBe('auto');
    expect(readTheme(undefined)).toBe('auto');
  });

  it('respecte un choix explicite', () => {
    expect(readTheme(fakeStorage({ [THEME_KEY]: 'dark' }))).toBe('dark');
    expect(readTheme(fakeStorage({ [THEME_KEY]: 'light' }))).toBe('light');
  });
});

describe('Thème — résolution de « auto »', () => {
  it('suit le système', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });

  it('un choix explicite l’emporte sur le système', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('Thème — bascule', () => {
  it('part de ce qui est affiché, pas de ce qui est mémorisé', () => {
    // Régression : depuis « auto » sur un système sombre, l’ancienne bascule
    // écrivait 'dark' — l’écran ne bougeait pas, le bouton semblait cassé.
    expect(nextTheme('auto', true)).toBe('light');
    expect(nextTheme('auto', false)).toBe('dark');
  });

  it('alterne toujours à partir d’un choix explicite', () => {
    expect(nextTheme('dark', false)).toBe('light');
    expect(nextTheme('light', true)).toBe('dark');
  });

  it('deux bascules ramènent au point de départ visible', () => {
    const first = nextTheme('auto', true);
    expect(nextTheme(first, true)).toBe('dark');
  });
});

describe('Thème — application au document', () => {
  it('« auto » retire l’attribut pour rendre la main à prefers-color-scheme', () => {
    const root = fakeRoot();
    applyTheme('dark', root);
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyTheme('auto', root);
    expect(root.getAttribute('data-theme')).toBe(null);
  });

  it('une valeur inconnue ne fige jamais un thème', () => {
    const root = fakeRoot();
    applyTheme('dark', root);
    applyTheme('néon', root);
    expect(root.getAttribute('data-theme')).toBe(null);
  });

  it('mémorise et applique d’un seul geste', () => {
    const storage = fakeStorage();
    const root = fakeRoot();
    saveTheme('dark', { storage, root });
    expect(readTheme(storage)).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');

    saveTheme('auto', { storage, root });
    expect(readTheme(storage)).toBe('auto');
    expect(root.getAttribute('data-theme')).toBe(null);
  });
});
