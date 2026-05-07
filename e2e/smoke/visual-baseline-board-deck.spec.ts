/**
 * Phase 7.G Turn LII (Board Deck v2 Turn 5/5) — visual-regression
 * baseline for the Board Deck v2 Hero section.
 *
 * Locks the Apple/Stripe minimalist hero layout (Turn XLVIII) +
 * narrative + metric/trend section (Turns XLIX-LI) shipped across
 * the Board Deck v2 5-turn redesign.
 *
 * Why a separate baseline (not bundled into `visual-baseline.spec.ts`):
 *   - HeatMap baseline screenshots `/budgeting/terminal`. Board Deck
 *     lives at `/budgeting/board-deck` — different page, different
 *     layout chain, different design tokens (cream vs near-black bg).
 *   - The HeatMap baseline can't catch Board Deck regressions; a
 *     dedicated spec keeps responsibilities sharp.
 *
 * Surface-targeting strategy:
 *   - Element-locator screenshot via `data-testid="board-deck-hero"`.
 *     Captures the hero box (eyebrow row + headline + composite score
 *     + lead-ins + CTA + AI attribution footer) — the highest-density
 *     v2 layout area; if it regresses, the rest of the page typically
 *     follows.
 *   - Mask LLM-driven regions (headline / lead-ins / attribution) so
 *     the baseline locks chrome, not narrative content. Each LLM run
 *     produces different prose; without masks, the snapshot would
 *     fail loud on every cache-miss.
 *
 * What this baseline DOES catch:
 *   - Hero box padding / margin regressions (Tailwind class swap, CSS
 *     token bump, broken responsive breakpoint).
 *   - Composite score number positioning + typography regressions.
 *   - CTA button alignment + visual hierarchy.
 *   - Background color regressions (cream → white = visible diff).
 *   - Eyebrow row layout regressions (org name / period mono alignment).
 *
 * What this baseline does NOT catch (by design):
 *   - LLM headline content (changes per run; masked).
 *   - LLM lead-in sentences (changes per run; masked).
 *   - LLM attribution timestamps (clock-driven; masked).
 *   - Sub-hero content (metrics row / trend chart / top alerts /
 *     footer actions) — covered by the structural smoke
 *     `board-deck-v2.spec.ts`. If a future regression hits one of
 *     those sections without DOM symptom, add a sibling spec
 *     (mirroring the snapshotcard pattern).
 *
 * Pre-conditions:
 *   - Same as `visual-baseline.spec.ts` (dev server / admin user / Postgres)
 *   - PLUS: snapshot must build (≥1 operational sub-co with at least
 *     one IndicatorValue this period). Demo + AZMADE seed both satisfy.
 *
 * First-time setup workflow (run ONCE per machine):
 *   1. Start dev server: LaunchAgent active OR `npm run dev`
 *   2. Run with --update-snapshots:
 *      `npm run test:e2e -- visual-baseline-board-deck --update-snapshots`
 *   3. Stage the new PNG: `git add e2e/smoke/visual-baseline-board-deck.spec.ts-snapshots/`
 *   4. Commit message MUST include token line:
 *      `BASELINE UPDATE: Board Deck v2 redesign — new hero section, killed v1 tables`
 *
 * Update workflow when intentional layout change ships:
 *   1. Run gate → see RED diff
 *   2. Verify diff is the change you intended (visually inspect PNG diff)
 *   3. Regenerate: `npm run test:e2e -- visual-baseline-board-deck --update-snapshots`
 *   4. Stage + commit with `BASELINE UPDATE: <reason>` token
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

test.describe('Phase 7.G Turn LII — Board Deck hero visual baseline', () => {
  test('Board Deck hero layout matches committed baseline', async ({
    page,
  }) => {
    // Snapshot + AI narrative cache lookup → 60s upper bound matches
    // the structural smoke; cache hit is sub-3s, cold-start cache miss
    // can be 30-45s under normal load.
    test.setTimeout(60_000);

    await loginAs(page);
    await page.goto('/budgeting/board-deck');

    // Locator the hero region. waitForLoadState below ensures fonts
    // are loaded before screenshot.
    const hero = page.getByTestId('board-deck-hero');
    await expect(hero).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('hero-score')).toBeVisible();

    // Critical for cross-run stability:
    //   1. `load` event fired — initial document + assets ready.
    //      `networkidle` is unsafe (long-lived SSE on terminal pages
    //      hangs idle detector; board-deck doesn't open SSE today
    //      but reuses the same shell).
    //   2. document.fonts.ready = custom fonts fully loaded; without
    //      this the first run captures a fallback-font frame that fails
    //      diff against the committed baseline.
    //   3. Small explicit settle window — narrative + sparkline batch
    //      paint a few hundred ms after mount.
    await page.waitForLoadState('load');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);

    // Capture + compare. Tolerance values come from playwright.config.ts
    // (DRY); per-test config covers only the masks (LLM-driven regions)
    // and the deterministic-rendering controls.
    //
    // Mask list (all LLM-output / clock-driven content):
    //   - hero-headline: AI-generated each cache miss
    //   - hero-lead-ins: AI-generated each cache miss
    //   - hero-ai-attribution: contains generatedAt timestamp
    //
    // animations: 'disabled' is set in the project defaults; reasserting
    // here for legibility / explicit documentation.
    await expect(hero).toHaveScreenshot('board-deck-hero.png', {
      animations: 'disabled',
      mask: [
        page.getByTestId('hero-headline'),
        page.getByTestId('hero-lead-ins'),
        page.getByTestId('hero-ai-attribution'),
      ],
    });
  });
});
