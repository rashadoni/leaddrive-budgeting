/**
 * Phase 7.G Turn D — Playwright E2E configuration.
 *
 * Audience: pre-prod smoke harness covering customer-facing flows
 * (login → terminal → wizard → recompute) against the running dev
 * server OR a dedicated staging server.
 *
 * Vitest covers unit + component tests (1677 cases as of 2026-05-03).
 * Playwright covers what vitest can't: real browser, real auth,
 * real DB integration. Strict separation — DON'T move vitest tests
 * here OR vice-versa.
 *
 * Local run convention:
 *   npm run test:e2e             # headless against http://localhost:3000
 *   npm run test:e2e:ui          # interactive UI mode
 *   npm run test:e2e:headed      # headed (visible browser)
 *
 * Pre-prod gate:
 *   bash scripts/pre-demo-check.sh && npm run test:e2e
 *
 * The dev server must be running OUTSIDE this config (LaunchAgent on
 * macOS dev / Docker Compose on production). We don't `webServer:`-
 * spawn one here because:
 *   1. LaunchAgent already manages the dev server (single-instance lock
 *      conflicts with Playwright's spawn).
 *   2. Production smoke runs against staging/prod URLs, not a spawned
 *      server.
 *   3. Spawning would re-run migrations + seed scripts on every test
 *      session — slow + side-effect-heavy.
 *
 * Authentication: tests authenticate via the credentials provider's
 * `/api/auth/callback/credentials` endpoint with seeded admin credentials
 * (see `e2e/fixtures/auth.ts`). Cookie persistence between tests via
 * `storageState`.
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // Match `*.spec.ts` only — keeps Playwright + vitest worlds non-overlapping.
  testMatch: '**/*.spec.ts',

  // Conservative timeouts for a single-VM dev server doing real DB work.
  // Customer-facing flows (wizard analyze + apply) can legitimately take
  // 5-15s; pad to 30s default.
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    // Visual-regression defaults for `toHaveScreenshot()` (Phase 7.G Turn E).
    // Closes CARRYOVER L132 — see `.claude/memory/feedback_visual_verification_gate.md`
    // for rationale + cross-machine plan.
    //
    // Tolerance values calibrated for v1 (macOS-only, no CI):
    //   maxDiffPixels: 200      — absorbs subpixel/antialiasing drift
    //                             (~0.07% of a 1280×800 viewport)
    //   maxDiffPixelRatio: 0.02 — upper-bound safety net for content-area
    //                             noise; catches structural shifts (cell
    //                             repositioning, row missing, > 2px drift)
    //   animations: 'disabled'  — kills frame-timing flake from CSS
    //                             transitions / motion tokens
    //
    // Linux baseline + matrix lands when CI does (tracked as user-owned 🔄
    // in CARRYOVER until trigger fires).
    toHaveScreenshot: {
      maxDiffPixels: 200,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },

  // Retry once on CI to absorb network jitter; never retry locally
  // (failures should surface immediately).
  retries: process.env.CI ? 1 : 0,

  // Single worker by default — most smoke tests share the same admin
  // user + write to shared org data, so parallel runs would collide.
  // Explicitly bump to >1 for read-only tests via `test.describe.parallel`.
  workers: process.env.CI ? 1 : 1,

  // Sequential reporter for local clarity; HTML reporter for CI artifact.
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['list']]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    // Real-browser locale matches the app's default. Tests can override
    // per-describe to exercise i18n paths.
    locale: 'en',
    timezoneId: 'Asia/Baku',
    // Failure artifacts: screenshot + trace on first retry only.
    screenshot: 'only-on-failure',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    video: 'off',
  },

  projects: [
    {
      // Sub-44 cont'd Turn D.1: chromium-only for v1. Add firefox/webkit
      // when v2 catches non-chromium-specific issues.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
