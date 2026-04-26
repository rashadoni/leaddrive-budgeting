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
  },
});
