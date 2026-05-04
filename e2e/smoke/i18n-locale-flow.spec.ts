/**
 * Phase 7.G Turn X — i18n locale-flow regression net.
 *
 * Closes Round-28 architect 💡 #2 (sub-32 follow-up, 56-turn 🔄): no
 * automated test verified that `cookie:NEXT_LOCALE=ru` produces a
 * Russian-rendered HTML response. Sub-32 (Phase 7.G Turn G) wired
 * `proxy.ts:49-54` to read the cookie and inject `x-locale` header so
 * `next-intl/server` resolves the locale-matching messages bundle on
 * server-rendered pages. A regression in `LanguageSwitcher → proxy.ts
 * → i18n/request.ts` would silently fall back to EN with no automated
 * guard.
 *
 * Test scope (3 cases):
 *   1. Default (no NEXT_LOCALE cookie) → terminal renders EN.
 *   2. NEXT_LOCALE=ru cookie set BEFORE first request → terminal
 *      renders RU strings (anchor: "Загрузка" loading copy from
 *      `messages/ru.json`).
 *   3. NEXT_LOCALE=az cookie → terminal renders AZ strings (anchor:
 *      "Yüklənir..." from `messages/az.json`).
 *
 * Anchor choice: shortest stable string available in all three
 * locale bundles for the same key (`loading`). Indicator-specific
 * strings would be more comprehensive but flakier — they depend on
 * which company/period the page mounts to. The loading copy fires
 * during initial hydration and is universally present.
 *
 * Pre-conditions: same as `login-and-terminal.spec.ts` (LaunchAgent
 * dev server, seeded admin, Postgres up).
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

test.describe('Phase 7.G Turn X — i18n locale-flow smoke', () => {
  test('default (no NEXT_LOCALE cookie) → terminal renders EN', async ({
    page,
    context,
  }) => {
    // Fresh context — no NEXT_LOCALE cookie set.
    await context.clearCookies();
    await loginAs(page);
    await page.goto('/budgeting/terminal');

    // EN copy from `messages/en.json:terminal.loading` (or any EN-only
    // anchor). Use a stable structural element instead — Panel labels
    // exist in every locale; pin the EN-only "Risk Terminal" header
    // text from `messages/en.json` if available.
    // Conservative: assert the page DID render (HeatMap presence) and
    // that no RU/AZ-specific text leaked through.
    await expect(
      page.getByText(/HeatMap|Risk Terminal|Indicator|Company/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    // Negative assertion: RU/AZ anchors must NOT appear.
    expect(await page.locator('text=Загрузка').count()).toBe(0);
    expect(await page.locator('text=Yüklənir').count()).toBe(0);
  });

  test('NEXT_LOCALE=ru cookie → server renders RU strings', async ({
    page,
    context,
  }) => {
    // Login first, then SET the locale cookie + reload so server-side
    // proxy.ts picks up the locale on the next render.
    await loginAs(page);
    await context.addCookies([
      {
        name: 'NEXT_LOCALE',
        value: 'ru',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/budgeting/terminal');

    // RU anchor from `messages/ru.json:terminal.loading` ("Загрузка...").
    // Use partial-match to tolerate ellipsis variants.
    await expect(page.getByText(/Загрузка/).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('NEXT_LOCALE=az cookie → server renders AZ strings', async ({
    page,
    context,
  }) => {
    await loginAs(page);
    await context.addCookies([
      {
        name: 'NEXT_LOCALE',
        value: 'az',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/budgeting/terminal');

    // AZ anchor from `messages/az.json:terminal.loading` ("Yüklənir...").
    await expect(page.getByText(/Yüklənir/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
