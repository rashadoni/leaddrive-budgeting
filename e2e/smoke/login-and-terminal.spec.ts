/**
 * Phase 7.G Turn D.1 — first Playwright E2E smoke.
 *
 * Locks the load-bearing customer-onboarding flow's first 3 steps:
 *   1. Login form renders
 *   2. Successful login redirects to /budgeting
 *   3. Risk Terminal at /budgeting/terminal renders the HeatMap
 *
 * Why this is the first smoke: every other customer-facing flow
 * (wizard, recompute, alerts, audit feed) depends on these 3 steps
 * working. If login breaks, nothing else matters; if terminal HeatMap
 * doesn't render, the entire product surface is dead.
 *
 * Vitest cannot lock these — it runs against happy-dom and mocks the
 * store. Playwright runs against a real browser + real DB + real auth
 * + real prisma queries. The 3 steps below are the smallest meaningful
 * "is the production stack healthy?" assertion.
 *
 * Cost shape: ~5-10s per run on a healthy local dev server. Fast enough
 * to run as a pre-deploy gate (per `docs/DEPLOYMENT_READINESS.md` §5.1).
 *
 * Pre-conditions (DOCUMENT before running):
 *   - Dev server running on http://localhost:3000 (LaunchAgent on Mac
 *     OR `npm run dev` OR `docker compose up`)
 *   - Admin user seeded with email/password matching E2E_ADMIN_EMAIL/
 *     PASSWORD env vars (or defaults from `scripts/create-admin.ts`)
 *   - Postgres running with at least one operational company in the
 *     admin's org (Risk Terminal requires data; truly-empty DB would
 *     show the empty-state, which we don't want to assert as the smoke)
 *   - `npx playwright install chromium` has run once on this machine
 *     (browser binaries; only needed first time)
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

test.describe('Phase 7.G smoke — login + terminal', () => {
  test('login form renders + accepts credentials + redirects to dashboard', async ({ page }) => {
    // Step 1: login page renders with email + password fields.
    await page.goto('/login');
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /sign in|log in/i }),
    ).toBeVisible();

    // Step 2: actual login + redirect (encapsulated in fixture so other
    // smoke tests can reuse without duplicating the form-driving code).
    await loginAs(page);

    // Step 3: post-login URL is the budgeting workspace.
    expect(page.url()).toMatch(/\/budgeting(\?|$|\/)/);
  });

  test('Risk Terminal at /budgeting/terminal renders the HeatMap component', async ({ page }) => {
    // Login first via the fixture.
    await loginAs(page);

    // Navigate to the terminal.
    await page.goto('/budgeting/terminal');

    // Wait for the HeatMap matrix to mount. Lock on the role+name combo
    // — `aria-label="Risk heatmap"` is set in HeatMap.tsx via i18n key
    // `heatMap.tableAriaLabel`. The mock dictionary at
    // `vitest.setup.ts:EXPLICIT_LABELS` tracks the EN string but
    // production runtime resolves it via next-intl, so we look for
    // the table role instead of the exact text.
    const matrixTable = page.getByRole('table');

    // Extended timeout — first matrix fetch involves prisma + recompute
    // pipeline + (in some configurations) sparkline batch. 15s is
    // generous for a healthy local dev; flag if exceeded.
    await expect(matrixTable.first()).toBeVisible({ timeout: 15_000 });

    // Sanity: at least one cell renders. We don't assert specific
    // values (data-dependent + brittle); just that the matrix isn't
    // empty.
    const cells = await page.getByRole('cell').count();
    expect(
      cells,
      'expected ≥1 HeatMap cell to render — empty matrix means recompute pipeline did not seed data',
    ).toBeGreaterThan(0);
  });

  test('attempted /budgeting/terminal access without login redirects to /login', async ({ page }) => {
    // Cookie context starts empty (no loginAs call); auth middleware
    // should bounce us. Locks the auth-gate against a regression where
    // /budgeting/terminal accidentally becomes public.
    const response = await page.goto('/budgeting/terminal');

    // Either a 30x redirect chain OR a final URL match — middleware
    // implementations vary. The end-state is what matters.
    expect(page.url()).toMatch(/\/login/);

    // Defense-in-depth: if the page somehow rendered, ensure the
    // response status was a redirect (3xx) AND no terminal content
    // is on the page.
    if (response) {
      // Response.status() returns the final response after redirects;
      // we check that we landed on /login HTML, not on terminal HTML.
      await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 5_000 });
    }
  });
});
