import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
      { test: { name: 'contract', include: ['test/contract/**/*.test.ts'], testTimeout: 30_000 } },
      // Live tests drive a real Chrome + Google account and may spend credits: only run when FLOW_E2E=1
      { test: { name: 'e2e', include: ['test/e2e/**/*.live.test.ts'], testTimeout: 1_900_000 } },
    ],
  },
});
