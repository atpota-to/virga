// Dev-only config for the harness.
//
//   npm run harness      → http://127.0.0.1:5174
//
// Runs the real app with exactly one module swapped: the atproto session is
// replaced by harness/fakeSession.jsx, which presents a made-up account as
// signed in and answers the network from fixtures. That is enough to open,
// use and screenshot every screen without an OAuth round trip.
//
// This config is never used by `npm run build`; the production entry is the
// root index.html and knows nothing about harness/.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const REAL_SESSION = fileURLToPath(new URL('./src/session/useAtprotoSession.jsx', import.meta.url));
const FAKE_SESSION = fileURLToPath(new URL('./harness/fakeSession.jsx', import.meta.url));

/**
 * Redirect every import of the session module to the fake, whatever relative
 * specifier the importer used. A plain `resolve.alias` can't do this: aliases
 * match the raw specifier, and every call site imports it relatively.
 */
function swapSessionModule() {
  return {
    name: 'harness-swap-session',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith('\0')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && resolved.id.split('?')[0] === REAL_SESSION) return FAKE_SESSION;
      return null;
    },
  };
}

/**
 * Serve harness/index.html for every HTML navigation. Installed eagerly, so
 * it runs before Vite's own fallback, which would serve the production shell
 * and boot the real app against the real network.
 */
function serveHarnessShell() {
  return {
    name: 'harness-shell',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = (req.url || '').split('?')[0];
        const isAsset = /\.[a-z0-9]+$/i.test(url);
        const isInternal = url.startsWith('/@') || url.startsWith('/node_modules');
        if (!isAsset && !isInternal && req.headers.accept?.includes('text/html')) {
          req.url = '/harness/index.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [swapSessionModule(), serveHarnessShell(), react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
  },
});
