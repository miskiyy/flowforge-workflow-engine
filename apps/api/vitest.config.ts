import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    // e2e.test.ts runs a real worker pool against the shared test database —
    // it polls ALL pending runs, not just the ones it created. Running test
    // files in parallel would let it race other files' "stays pending"
    // assertions on runs those files are mid-way through asserting on.
    fileParallelism: false,
  },
});
