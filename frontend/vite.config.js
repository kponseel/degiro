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
        manualChunks: {
          react: ['react', 'react-dom'],
          recharts: ['recharts'],
        },
      },
    },
  },
});
