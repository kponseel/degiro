import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['backend/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^next$', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['frontend/**/*.{js,jsx}'],
    plugins: { react: reactPlugin },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Marque les composants référencés en JSX comme utilisés (ESLint core ignore le JSX).
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'off', // runtime JSX automatique (Vite)
      'no-unused-vars': 'warn',
    },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
