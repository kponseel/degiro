import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Base de test dédiée + jeton fixe, injectés dans l'environnement des tests
    // avant le chargement de la config (dotenv n'écrase pas une variable déjà définie).
    env: {
      DB_NAME: 'degiro_test',
      API_TOKEN: 'test_token_0123456789',
    },
    globalSetup: ['./test/setup.global.js'],
    // Les fichiers de test partagent la même base : pas d'exécution concurrente.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
