import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Live smoke tests that hit real JIRA / GitHub / MCP. They self-skip when
    // the relevant credentials are absent from config.json / the environment.
    include: ['test/integration/**/*.integration.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
