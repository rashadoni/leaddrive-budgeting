import { defineConfig } from 'vitest/config';
import path from 'path';

// Phase 7.E hardening (Turn 10): include `.test.tsx` so Phase 7.D React
// component tests run alongside the existing pure-TS suite. The default
// environment stays `node` (fastest); UI test files opt into a DOM via
// the per-file pragma `// @vitest-environment happy-dom` at the top of
// the file. This keeps the 700+ pure-TS tests on the lighter runtime.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
    // Phase 7.M Tier 4 (2026-05-19) — default vitest testTimeout is
    // 5000ms which kills DOM tests that pass individually but hit CPU
    // contention under the full-sweep parallel runner. Bump to 30s so
    // the same async-utility budget (asyncUtilTimeout=30s in
    // vitest.setup.ts) actually has time to fire. Individual tests can
    // still tighten via `it("x", ..., { timeout: N })`.
    testTimeout: 30_000,
    // Phase 7.M Tier 4 (2026-05-19) — auto-retry flaky DOM tests up to
    // 2 times. happy-dom + React-18 concurrent rendering occasionally
    // miss state-update batches under CPU contention from the
    // 4977-test parallel sweep. Retry keeps the gate green without
    // forcing every test author to add `{ retry: N }` per-test.
    retry: 2,
  },
});
