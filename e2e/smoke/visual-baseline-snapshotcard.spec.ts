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
 *   - Determinism (2026-05-29): the value row + sparkline are masked, so
 *     the gate locks the card's CHROME + LAYOUT, never the recomputing
 *     numbers. It catches frame / padding / label / height-chain
 *     regressions; value+color rendering is unit-tested in
 *     CompanySnapshot.test.tsx. See the mask block below for the two
 *     prior masking bugs this fixed.
 *
 * Pre-conditions:
 *   - Same as `visual-baseline.spec.ts` (dev server / admin user / Postgres)
 *   - PLUS: the admin's org has the live `AZSEKER-AZSF` L2 operational
 *     company with ≥1 populated IndicatorValue (257 today). If the AZSEKER
 *     group is ever re-coded, update the `CO GO` target below to another
 *     L2 op-co (AZSEKER-{CPC,EDEN,HORIZON,MALT}; NOT PROMALT — data-pending).
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

    // Activate a LEVEL-2 OPERATIONAL company so CompanySnapshot renders
    // cards. Level-1 sub-groups (the `AZSEKER` parent) have no indicators
    // on themselves (rollup architecture: 0 own BudgetLines) so selecting
    // one sets `activeCompanyCode` but CompanySnapshot renders zero cards.
    //
    // 2026-05-29 fix: the old code targeted `AAC-MAIN`, a company from the
    // AZMADE/AAC seed that Phase 2.3 REMOVED — it is no longer in any
    // matrix, so the snapshot card never rendered and this gate had been
    // 100% broken (failing at the `snapshot-card` visibility wait, NOT at
    // login — login with the Admin123! default works). Repointed to a live
    // L2 entity: `AZSEKER-AZSF` (Azərşəkər Sugar — the flagship sugar
    // op-co, 257 IndicatorValues; core business, least likely to ever be
    // restructured). Any of AZSEKER-{AZSF,CPC,EDEN,HORIZON,MALT} works;
    // PROMALT is excluded (carries a data-pending banner, renders no cards).
    //
    // Set it via CommandBar — `data-cmd-bar="true"` input is more reliable
    // than clicking CompanyTree rows (the tree row's tabIndex=0 inner div
    // doesn't accept Playwright clicks reliably across React's synthetic
    // event handling). CommandBar has a normal `<input>` + `<form onSubmit>`
    // so standard fill+submit works → `terminalStore.setActiveCompanyCode`
    // → VarianceExplainerPanel re-renders with `<CompanySnapshot>`.
    const cmdBar = page.locator('[data-cmd-bar="true"]');
    await expect(cmdBar).toBeVisible({ timeout: 5_000 });
    await cmdBar.fill('AZSEKER-AZSF CO GO');
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
    // Masks — every data-driven region (determinism fix 2026-05-29):
    //   - the sparkline SVG (redraws as IVs change), and
    //   - the value row (`snapshot-card-value`: status glyph + value text
    //     + status color — all recompute on every IndicatorValue change).
    //
    // Both are the SAME data-drift class that left the board-deck gate
    // permanently red; masking them keeps the gate green on clean code and
    // red only on a real layout regression. The card's frame (border / bg
    // / rounded / padding), the indicator label, and the masked bands'
    // positions still lock the SnapshotCard layout fingerprint + the
    // `flex-col h-full` height chain this spec exists to guard.
    //
    // Two prior masking BUGS fixed here:
    //   1. The old mask was `.sparkline svg` — there is NO `.sparkline`
    //      class in the rendered output (the class never existed), so the
    //      locator matched 0 elements and silently masked NOTHING — the
    //      sparkline was a live drift vector. The Sparkline renders an
    //      `<svg role="img">`, so mask `svg` directly.
    //   2. The value text was left unmasked "to catch CSS regressions" —
    //      but that made the baseline data-fragile. Color/typography
    //      coverage moves to CompanySnapshot.test.tsx (DOM/class assert),
    //      which is the robust place for it.
    await expect(snapshotCard).toHaveScreenshot('snapshotcard.png', {
      maxDiffPixels: 100,
      caret: 'hide',
      animations: 'disabled',
      mask: [
        snapshotCard.locator('svg'),
        snapshotCard.getByTestId('snapshot-card-value'),
      ],
    });
  });
});
