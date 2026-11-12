import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 127.0.0.1, not localhost: a local sign-in comes back to this address
    // (see src/lib/oauthClient.js), and the session it stores belongs to the
    // origin it was started from.
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // three.js is most of the bytes and changes least: its own file, so a
        // release that doesn't touch the hillside doesn't make anyone fetch
        // it again.
        manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined),
      },
    },
  },
});
