/**
 * Phase 7.G Turn D — Auth fixture for Playwright E2E.
 *
 * Provides a `loginAs(page, credentials)` helper that drives the actual
 * login form on `/login` (via the credentials provider) instead of
 * hand-crafting session cookies. This is intentional — we want the E2E
 * tests to exercise the full auth contract (form render, submit POST,
 * session callback, redirect, dashboard render), not bypass it via
 * synthetic cookie injection.
 *
 * The seeded admin user comes from `scripts/create-admin.ts` (run once
 * after first deploy per `docs/ADMIN_RUNBOOK.md` §1.2). Credentials are
 * env-driven so tests run against any environment (dev / staging / prod
 * smoke); defaults match the local `scripts/create-admin.ts` defaults
 * for zero-config local dev.
 */

import { Page, expect } from '@playwright/test';

export interface E2ECredentials {
  email: string;
  password: string;
}

/**
 * Default credentials for local dev — match `scripts/create-admin.ts`
 * fallback. Override via env for any non-local environment.
 */
export function getCredentials(): E2ECredentials {
  return {
    email: process.env.E2E_ADMIN_EMAIL ?? 'admin@budgetpro.com',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'admin123',
  };
}

/**
 * Drive the credentials login form. After a successful submit:
 *   - URL transitions to `/budgeting` (default post-login destination)
 *   - Session cookie is set in the page context for subsequent requests
 *
 * Throws via `expect()` if any step fails — surfaces as a Playwright
 * assertion error with the relevant DOM state attached.
 */
export async function loginAs(
  page: Page,
  credentials: E2ECredentials = getCredentials(),
): Promise<void> {
  await page.goto('/login');

  // The credentials form has labeled email + password inputs; lock on
  // the labels (not on input names — implementation detail) so a
  // future input-name change doesn't break the smoke.
  await page.getByLabel(/email/i).fill(credentials.email);
  await page.getByLabel(/password/i).fill(credentials.password);

  // Submit + wait for the redirect to the dashboard. Lock on URL match
  // rather than waiting for any specific element (which would be
  // page-content-dependent).
  await Promise.all([
    page.waitForURL(/\/budgeting(\?|$|\/)/, { timeout: 10_000 }),
    page.getByRole('button', { name: /sign in|log in/i }).click(),
  ]);

  // Sanity: confirm the session cookie landed.
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find(
    (c) =>
      c.name === 'next-auth.session-token' ||
      c.name === '__Secure-next-auth.session-token' ||
      c.name === 'authjs.session-token' ||
      c.name === '__Secure-authjs.session-token',
  );
  expect(
    sessionCookie,
    `expected a next-auth/authjs session cookie after login as ${credentials.email}`,
  ).toBeDefined();
}
