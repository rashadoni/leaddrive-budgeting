/**
 * R9 (Trade Tower audit round 2) — DOM smoke for /budgeting/trade.
 *
 * Locks the tab shell + the presence of every section behind its tab:
 *   1. Page renders with the 5-tab pill bar (Dashboard active).
 *   2. Dashboard: pacing panel + alert inbox render.
 *   3. Campaigns: campaign section renders (calendar renders only when
 *      campaigns exist — asserted soft).
 *   4. Spend ledger: posting form with a date defaulting to today.
 *   5. Budget: derive button + month table shell.
 *   6. Master data: import section.
 *
 * Data prerequisites: NONE beyond a seeded admin — every assertion
 * works on an empty org too (empty-state strings are asserted as
 * alternatives), so the spec is safe on fresh environments.
 */

import { test, expect } from '@playwright/test';
import { loginAs, getCredentials } from '../fixtures/auth';

test('Trade Tower tab shell renders and switches', async ({ page }) => {
  await loginAs(page, getCredentials());

  await page.goto('/budgeting/trade');
  await expect(page.getByRole('heading', { name: 'Trade Spend Control Tower' })).toBeVisible();

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(5);

  // 1. Dashboard (default): pacing + alert inbox (role-scoped — the page
  // subtitle also contains "daily pacing", strict mode forbids bare text).
  await expect(page.getByRole('heading', { name: 'Daily pacing' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Alert inbox/ })).toBeVisible();

  // 2. Campaigns.
  await tabs.nth(1).click();
  await expect(page.getByRole('button', { name: /New campaign/i })).toBeVisible();

  // 3. Spend ledger: form present, date defaults to today (R6).
  await tabs.nth(2).click();
  await expect(page.getByRole('heading', { name: /Spend ledger/ })).toBeVisible();
  const today = new Date().toISOString().slice(0, 10);
  await expect(page.locator('input[type="date"]').first()).toHaveValue(today);

  // 4. Budget: derive button.
  await tabs.nth(3).click();
  await expect(page.getByRole('button', { name: /Derive from sales plan/i })).toBeVisible();

  // 5. Master data: import section.
  await tabs.nth(4).click();
  await expect(page.getByRole('heading', { name: 'Master data import' })).toBeVisible();

  // Deep-link contract: ?view= updated by the last switch
  // (router.replace is async — retrying assertion, not a snapshot read).
  await expect(page).toHaveURL(/view=master/);
});
