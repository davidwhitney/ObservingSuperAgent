import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Hermetic component tests only. Live integration tests live under
    // test/integration and run via `npm run test:integration`.
    include: ['test/component/**/*.test.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
