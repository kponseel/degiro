import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';
import { applyTheme, readTheme } from './lib/theme.js';

// Thème : le choix explicite prime, sinon 'auto' — donc aucun `data-theme`, et
// la feuille de styles suit `prefers-color-scheme`. Forcer le clair ici servait
// un écran blanc éclatant aux utilisateurs dont le système est en sombre, alors
// que le thème sombre complet existe déjà dans styles.css.
applyTheme(readTheme(localStorage));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
