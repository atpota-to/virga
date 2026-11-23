import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.js: the modules under test are pure and
// isomorphic, or Node-only server code, so they need neither the React plugin
// nor a DOM.
//
// harness/ is in because its fixtures are the only description of what the
// network's answers look like that nothing else checks.
//
// ios/parity/ is in so a change to the web app's behaviour that the iOS app
// hasn't followed fails here: its fixtures must match what the web code
// computes now, and every web module must be mapped to its Swift port
// (ios/parity/README.md).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'harness/**/*.test.js', 'server/**/*.test.js', 'worker/**/*.test.js', 'ios/parity/**/*.test.js'],
    // A PGlite database starts in beforeAll and takes a few seconds.
    hookTimeout: 60_000,
    testTimeout: 15_000,
  },
});
