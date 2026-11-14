// Flat ESLint config (ESLint 9). Light-touch: enforce the react-hooks rules
// and surface obvious mistakes. Prettier owns style.
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

const APP_FILES = ['src/**/*.{js,jsx}', 'harness/**/*.{js,jsx}'];
const NODE_FILES = ['api/**/*.js', 'server/**/*.js', 'scripts/**/*.js', '*.config.js'];

// src/ is the browser bundle. Server code would drag service-role clients and
// Node built-ins into it (and break the build), so nothing there may reach
// into server/ or api/. server/bundleBoundary.test.js checks the same thing,
// dynamic imports included.
const SERVER_BOUNDARY = {
  regex: '^(?:\\./)?(?:\\.\\./)+(?:server|api)(?:/|$)',
  message: 'src/ is the browser bundle: it must not import from server/ or api/.',
};
const NODE_ONLY = {
  group: ['@supabase/*', '@atproto/oauth-client-node', 'node:*'],
  message: 'src/ is the browser bundle: Node-only and server-only packages stay in server/.',
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', '.vercel/**'],
  },

  js.configs.recommended,

  // The browser app and the harness.
  { files: APP_FILES, ...react.configs.flat.recommended },
  { files: APP_FILES, ...react.configs.flat['jsx-runtime'] },
  {
    files: APP_FILES,
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      // Node globals too: src/config.js and src/lib/oauthClient.js are also
      // loaded under Node by the server.
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'off',
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
    },
  },

  // The bundle boundary. Tests aren't bundled (and some test api/ functions),
  // so they are left out.
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/**/*.test.{js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [SERVER_BOUNDARY, NODE_ONLY] }],
    },
  },

  // Server code, Vercel functions, scripts and config files: Node only, so a
  // stray `window` is a no-undef error.
  {
    files: NODE_FILES,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
    },
  },
];
