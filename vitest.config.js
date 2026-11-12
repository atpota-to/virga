import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.js: the modules under test are pure and
// isomorphic, so they need neither the React plugin nor a DOM.
//
// harness/ is in because its fixtures are the only description of what the
// network's answers look like that nothing else checks.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'harness/**/*.test.js'],
  },
});
