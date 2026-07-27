import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

// Thème : clair par défaut, choix mémorisé. 'auto' = suit le système.
const savedTheme = localStorage.getItem('degiro_theme') || 'light';
if (savedTheme === 'light' || savedTheme === 'dark') {
  document.documentElement.setAttribute('data-theme', savedTheme);
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
