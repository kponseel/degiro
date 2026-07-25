import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En dev, le frontend tourne sur Vite (5173) et proxifie /api vers l'API Express (3000),
// pour reproduire le comportement « même origine » de la prod.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Forme fonctionnelle : compatible rollup ET rolldown (moteur de Vite 8),
        // qui n'accepte plus la table { nom: [modules] }.
        manualChunks(id) {
          if (id.includes('node_modules/recharts')) return 'recharts';
          if (id.includes('node_modules/react-dom') || /node_modules\/react(\/|$)/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});
