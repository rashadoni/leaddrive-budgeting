/**
 * Phase 7.G Turn E — visual-regression baseline for the Risk Terminal HeatMap.
 *
 * Closes CARRYOVER L132 (longest-OPEN architect ⚠️ on developer's plate, 19 turns).
 *
 * Why HeatMap is the load-bearing surface:
 *   - It's the highest-leverage layout in the app (3k cells × 50 indicators × 60 cos).
 *   - The R15→R21 saga (M7 status-band shape coding) ran exclusively against this
 *     surface — every regression in that 7-round chain was a HeatMap layout/shape
 *     break that tsc + vitest passed cleanly. Empirically the highest-yield place
 *     to gate.
 *   - Customer-facing pre-demo: if HeatMap renders correctly, the rest of the
 *     terminal grid system is structurally healthy.
 *
 * Why DOM-assertion tests can't catch what this gate catches:
 *   - DOM tests check existence + role + text — not pixel positioning, padding,
 *     spacing, color, font metrics, alignment.
 *   - Layout commits (CSS-only, Tailwind class swap, design-token bump) leave
 *     DOM structure intact while breaking visual rendering.
 *   - Pattern documented in `.claude/memory/feedback_visual_verification_gate.md`
 *     — ad-hoc `mcp__computer-use__screenshot` was the only catch mechanism
 *     before Turn E.
 *
 * Tolerance & masking strategy: see `playwright.config.ts:expect.toHaveScreenshot`
 * and the inline `mask` array below. Project defaults absorb subpixel/antialiasing
 * drift; per-test mask covers data-dependent regions (sparklines, time elements,
 * any `[data-volatile="true"]` marker the developer adds to a Date-driven cell).
 *
 * Update workflow when intentional layout change ships:
 *   1. Run gate → see RED diff
 *   2. Verify diff is the change you intended (visually inspect PNG diff)
 *   3. Regenerate: `npm run test:e2e -- --update-snapshots`
 *   4. Stage the new PNG: `git add e2e/smoke/visual-baseline.spec.ts-snapshots/`
 *   5. Commit message MUST include token line: `BASELINE UPDATE: <reason>`
 *
 * Pre-conditions:
 *   - Dev server running on http://localhost:3000 (LaunchAgent / Docker)
 *   - Admin user seeded; loginAs() succeeds
 *   - Postgres has ≥1 operational company in the admin's org (HeatMap renders
 *     ≥1 cell — empty matrix renders the empty-state, which is a different
 *     surface and should have its own baseline if/when needed)
 *   - `npx playwright install chromium` has run once on this machine
 *   - Baseline already committed at `visual-baseline.spec.ts-snapshots/
 *     terminal-heatmap-chromium-darwin.png`. First-time setup: run with
 *     `--update-snapshots` to generate.
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

test.describe('Phase 7.G Turn E — visual-regression baseline', () => {
  test('terminal HeatMap layout matches committed baseline', async ({ page }) => {
    // Pre-set the WelcomeHint dismissal flag so the modal does NOT render.
    // Without this, every fresh-context Playwright run sees the welcome modal
    // overlay the right half of the HeatMap — the baseline ends up gating the
    // modal, not the HeatMap surface that L132 named as the target. Storage
    // key + value must match `WelcomeHint.tsx:22,36` (`STORAGE_KEY = 'terminal-welcome-hint-v1'`).
    // Using addInitScript so the flag is set BEFORE any page script runs (the
    // hint's first render checks localStorage before mounting).
    await page.context().addInitScript(() => {
      try {
        window.localStorage.setItem('terminal-welcome-hint-v1', '1');
      } catch {
        // localStorage disabled (private mode etc.) — accept silent failure
        // here; welcome modal will render as an overlay covering the HeatMap.
        // The baseline expects no modal, so the diff would fail loud against
        // the modal-overlaid frame — that's the right outcome (fail-loud > silent-pass).
      }
    });

    // Authenticate via the real form (same contract as DOM-level smokes).
    await loginAs(page);

    // Navigate to the highest-leverage layout surface.
    await page.goto('/budgeting/terminal');

    // Wait for HeatMap to mount AND its data to settle. The first matrix
    // fetch involves prisma + recompute pipeline — generous timeout matches
    // login-and-terminal.spec.ts:73.
    const matrixTable = page.getByRole('table').first();
    await expect(matrixTable).toBeVisible({ timeout: 15_000 });

    // Wait for at least one cell to render. Without this, the screenshot
    // could capture the loading skeleton instead of the populated grid.
    const cells = page.getByRole('cell');
    await expect(cells.first()).toBeVisible({ timeout: 10_000 });

    // Critical for cross-run stability:
    //   1. `load` event fired — initial document + assets ready. We CANNOT
    //      use `networkidle` because the terminal opens a long-lived SSE
    //      connection to `/api/events/stream` (recompute pipeline event
    //      bus) that never settles, hanging Playwright's idle detector.
    //   2. document.fonts.ready = custom fonts fully loaded; without this
    //      the first run captures a fallback-font frame that fails diff
    //      against the committed baseline (which used the loaded font).
    //   3. Small explicit settle window — sparkline batch + IV refresh
    //      kick off a few hundred ms after mount; this lets them paint
    //      before screenshot capture so the snapshot reflects steady-state.
    await page.waitForLoadState('load');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);

    // Capture + compare against the committed baseline. Tolerance values
    // come from playwright.config.ts (DRY); per-test config covers only
    // the masks (data-dependent regions) and the deterministic-rendering
    // controls (caret, fullPage).
    //
    // Mask list:
    //   - Sparkline SVGs: data-driven shape, redraws as IVs change.
    //   - <time> elements: clock-dependent text content.
    //   - [data-volatile="true"]: opt-in per-cell marker for any future
    //     element whose content drifts independently of layout (e.g., a
    //     Date.now()-driven counter). Honors the cooperative contract —
    //     when a future cell needs to opt out of visual diff, set the
    //     attribute, no spec change required.
    //
    // animations: 'disabled' is set in the project defaults; reasserting
    // here for legibility / explicit documentation of why this test is
    // deterministic.
    await expect(page).toHaveScreenshot('terminal-heatmap.png', {
      fullPage: false,
      caret: 'hide',
      animations: 'disabled',
      mask: [
        page.locator('.sparkline svg'),
        page.locator('time'),
        page.locator('[data-volatile="true"]'),
      ],
    });
  });
});
