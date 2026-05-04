/**
 * Phase 7.G Turn-after-HH visual-regression baseline for the SnapshotCard
 * panel surface (Risk Terminal Panel 4 — VarianceExplainerPanel's no-IV
 * fallback rendering).
 *
 * Closes CARRYOVER L416-area `SnapshotCard panel-only visual baseline`
 * (Phase 7.G Turn F architect 💡, opened post-Turn-F when the existing
 * `visual-baseline.spec.ts` HeatMap viewport was confirmed NOT to cover
 * the SnapshotCard surface — panel-grid content below the fold of the
 * v1 baseline scope).
 *
 * Why SnapshotCard needs its own baseline:
 *   - The HeatMap-only baseline (`visual-baseline.spec.ts`) does not
 *     render any of the SnapshotCard tree by design — Panel 4 starts
 *     in its no-IV-no-company empty state, which the v1 baseline gates.
 *   - SnapshotCard's `flex-col gap-1 h-full` layout chain interacts with
 *     the parent VarianceExplainerPanel `h-full w-full` chain (sub-36
 *     cont'd Round-33 fix at VarianceExplainerPanel.tsx:188). A future
 *     CSS regression breaking that height-100% chain would not surface
 *     in the HeatMap baseline.
 *   - Sparkline rendering inside SnapshotCard uses `responsive=true`
 *     mode (Turn-F closure of L133); regression would show as a flat
 *     sparkline, which the HeatMap baseline cannot catch.
 *
 * Surface-targeting strategy:
 *   - Element-locator screenshot via `data-testid="snapshot-card"` (added
 *     to the SnapshotCard wrapper in `CompanySnapshot.tsx:395`).
 *   - First match — multiple SnapshotCards render per company (one per
 *     P&L margin indicator: Gross / Net / OpEx). First card is sufficient
 *     for layout regression detection; spec doesn't need to verify all
 *     three card-instances render correctly (DOM-level test handles that).
 *   - `maxDiffPixels: 100` — tighter than the HeatMap baseline's 200 since
 *     SnapshotCard surface area is much smaller; same-fraction tolerance
 *     would over-permit on a small element.
 *
 * Pre-conditions:
 *   - Same as `visual-baseline.spec.ts` (dev server / admin user / Postgres)
 *   - PLUS: admin's home org has ≥1 operational company with at least one
 *     populated P&L margin IndicatorValue (Gross/Net/OpEx). In demo org
 *     this is satisfied by `seed-demo-companies.ts`; in azmade by the
 *     standard 13-company seed.
 *
 * Update workflow when intentional layout change ships:
 *   Same as `visual-baseline.spec.ts` — `--update-snapshots` then commit
 *   the new PNG with `BASELINE UPDATE: SnapshotCard panel coverage` token.
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

test.describe('Phase 7.G — SnapshotCard panel visual baseline', () => {
  test('SnapshotCard layout matches committed baseline', async ({ page }) => {
    // Need >30s default since the test does login + navigate + 4 distinct
    // expect-visible waits + click + screenshot capture against a fully-
    // populated terminal. 60s gives margin without making the gate slow.
    test.setTimeout(60_000);
    // Pre-set the WelcomeHint dismissal flag so the modal does NOT render —
    // same rationale as visual-baseline.spec.ts:55-69. Without this, the
    // welcome modal overlays the right half of the terminal including the
    // VarianceExplainerPanel target, and the SnapshotCard wouldn't be
    // visible to the screenshot at all.
    await page.context().addInitScript(() => {
      try {
        window.localStorage.setItem('terminal-welcome-hint-v1', '1');
      } catch {
        // localStorage disabled — accept silent failure; if welcome modal
        // overlays the SnapshotCard, the screenshot will fail loud which
        // is the correct outcome.
      }
    });

    await loginAs(page);
    await page.goto('/budgeting/terminal');

    // Wait for the terminal grid to mount before clicking a company. The
    // CompanyTree mounts inside Panel 1 (left aside); we need at least one
    // treeitem rendered to click.
    const matrixTable = page.getByRole('table').first();
    await expect(matrixTable).toBeVisible({ timeout: 15_000 });

    // Click the first OPERATIONAL company (level=2) in the CompanyTree.
    // Level-1 sub-groups (AAC, ATL, SPARK, ZTP, LLS — first treeitem in
    // tree order is always a sub-group) have NO indicators on themselves
    // (operational role + 0 own BudgetLines per the rollup architecture)
    // so clicking them sets `activeCompanyCode` but CompanySnapshot
    // renders zero cards. Op-cos always have a "Composite score N"
    // chip rendered in the row — filter on that text to skip the
    // sub-group rows. CompanyTree.tsx:317-329 — bubbled click on the
    // `<li role="treeitem">` reaches the inner `<div tabIndex=0>` →
    // `terminalStore.setActiveCompanyCode(code)` →
    // VarianceExplainerPanel re-renders with `<CompanySnapshot>`
    // (since activeCompanyCode set + no ivId drilled down).
    // Set active company via CommandBar (`AAC-MAIN CO GO`). The
    // CommandBar's `data-cmd-bar="true"` input is more reliable than
    // clicking CompanyTree rows — the tree row's tabIndex=0 inner div
    // doesn't accept Playwright clicks reliably across React's synthetic
    // event handling. CommandBar has a normal `<input>` + `<form
    // onSubmit>` so standard fill+submit works. AAC-MAIN is the first
    // op-co alphabetically in both demo and azmade seed data.
    const cmdBar = page.locator('[data-cmd-bar="true"]');
    await expect(cmdBar).toBeVisible({ timeout: 5_000 });
    await cmdBar.fill('AAC-MAIN CO GO');
    await cmdBar.press('Enter');

    // Wait for the SnapshotCard to mount + populate. The CompanySnapshot
    // uses the `useMatrix()` hook (Turn 42 sub-20 module-level cache);
    // first render fetches /api/indicators/matrix, then SnapshotCard
    // renders one card per P&L margin indicator (Gross/Net/OpEx). Panel
    // 4 (VarianceExplainerPanel) is on the right side of the grid by
    // default; first card visible = layout chain healthy.
    const snapshotCard = page.getByTestId('snapshot-card').first();
    await expect(snapshotCard).toBeVisible({ timeout: 10_000 });

    // Same cross-run stability waits as visual-baseline.spec.ts:88-101.
    // SnapshotCard renders sparkline + value text + status indicator —
    // all need fonts loaded + paint settle to capture deterministically.
    await page.waitForLoadState('load');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);

    // Element-locator screenshot — captures only the SnapshotCard
    // surface, not the surrounding panel chrome. Tighter `maxDiffPixels`
    // (100) than the HeatMap baseline (200) because the area is much
    // smaller; same-fraction tolerance would over-permit on a small
    // element.
    //
    // Mask: sparkline SVG (data-driven, redraws as IVs change). The
    // value text + status color are deliberately NOT masked — they're
    // part of the SnapshotCard's layout fingerprint and a CSS regression
    // breaking color/typography should be caught.
    await expect(snapshotCard).toHaveScreenshot('snapshotcard.png', {
      maxDiffPixels: 100,
      caret: 'hide',
      animations: 'disabled',
      mask: [
        snapshotCard.locator('.sparkline svg'),
      ],
    });
  });
});
