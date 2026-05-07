/**
 * Phase 7.G Turn XLV (Phase D.4) — Playwright smoke for IntelFeedPanel.
 *
 * Locks the IntelFeedPanel modal flow against the running dev server
 * (real next-auth + real PanelGrid wire-up). Doesn't run the actual
 * AI Web Crawler — that costs LLM tokens AND requires Anthropic key
 * configured. Instead, drives the UI surface: open via INT GO, panel
 * renders with role=dialog + aria-label, Refresh button visible to
 * admin, Escape closes, command-bar dispatch loop is live.
 *
 * Pre-conditions (DOCUMENT before running):
 *   - Dev server running on http://localhost:3000 (LaunchAgent on Mac
 *     OR `npm run dev`).
 *   - Admin user seeded per `scripts/create-admin.ts` (matches
 *     E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD env vars).
 *   - Postgres running with at least one company in the admin's org
 *     (terminal page assumes data — empty matrix would block
 *     CommandBar rendering).
 *   - Optional: ANTHROPIC_API_KEY set for the Refresh button to NOT
 *     503; the smoke does NOT click Refresh (LLM cost), only verifies
 *     the button renders for admin.
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

test.describe('Phase 7.G D.4 smoke — IntelFeedPanel via INT GO', () => {
  test('admin opens INT GO from CommandBar, modal renders + closes on Escape', async ({
    page,
  }) => {
    await loginAs(page);
    await page.goto('/budgeting/terminal');

    // HeatMap mounts first — gate so we know terminal shell is alive.
    await expect(page.getByRole('table').first()).toBeVisible({
      timeout: 15_000,
    });

    // CommandBar input — uses placeholder text or aria-label depending
    // on locale. Find by role to avoid coupling to specific copy.
    const commandInput = page.getByRole('textbox').first();
    await expect(commandInput).toBeVisible();

    // Type INT GO + Enter (the parser dispatches on Enter; the GO
    // terminator is required).
    await commandInput.click();
    await commandInput.fill('INT GO');
    await commandInput.press('Enter');

    // Modal opens with role=dialog + aria-label "Intel feed" (English
    // default; other locales would show the localized string but the
    // role+aria-modal contract holds).
    const dialog = page.getByRole('dialog', { name: /intel feed/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Refresh button visible to admin (gated by useSession()'s role).
    // Don't CLICK it — that fires a real LLM crawl with Anthropic
    // tokens. Just verify it's in the DOM for admin.
    const refreshBtn = dialog.getByTestId('intel-refresh-button');
    await expect(refreshBtn).toBeVisible();

    // Escape closes the modal.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });
});
