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
 * smoke). The password intentionally has no repository default: a checked-in
 * credential is unsafe even when it is described as local-only.
 */

import { Page, expect } from '@playwright/test';

export interface E2ECredentials {
  email: string;
  password: string;
}

/**
 * The email may use the non-secret local admin identifier. The password is
 * mandatory so tests cannot silently reuse a leaked demo credential.
 */
export function getCredentials(): E2ECredentials {
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      'E2E_ADMIN_PASSWORD is required; BudgetPro does not keep an E2E password in the repository.',
    );
  }

  return {
    email: process.env.E2E_ADMIN_EMAIL ?? 'admin@budgetpro.com',
    password,
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
    // 60s (was 25s): the post-login redirect waits on the credentials callback
    // + session write + a first-hit compile of the /budgeting route on a cold
    // dev server. 10s was too tight and flaked ~4 specs at login under load
    // (2026-06-03). The redirect is normally <2s on a warm server, but the
    // password-hash callback alone reached 21.3s under concurrent local load;
    // session hydration + dashboard navigation then legitimately crossed the
    // old 25s ceiling. This remains a timeout, not a sleep.
    page.waitForURL(/\/budgeting(\?|$|\/)/, { timeout: 60_000 }),
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
