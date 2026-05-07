/**
 * Phase 7.G Turn LII (Board Deck v2 Turn 5/5) — Playwright DOM smoke
 * for the redesigned `/budgeting/board-deck` page.
 *
 * Locks the v2 information architecture against the running dev server
 * (real next-auth + real Prisma + cached AI narrative). This is the
 * structural counterpart of the visual baseline (`visual-baseline-board-deck.spec.ts`):
 *   - structural smoke (this file): asserts each v2 section is mounted
 *     and visible — catches a missing/swapped component, broken
 *     getOrCreateNarration cache wiring, removed testid hooks.
 *   - visual baseline (sibling spec): asserts the hero region's layout
 *     pixels match the committed PNG — catches CSS-only regressions
 *     that DOM tests can't see.
 *
 * Does NOT click the Export PPTX button — that path takes ~3-90s
 * (cache hit vs cold-start LLM call) and produces a PPTX that this
 * smoke isn't equipped to introspect; the route's behavior is locked
 * by `export-pptx/handler.test.ts` (vitest, 10 cases).
 *
 * Pre-conditions (DOCUMENT before running):
 *   - Dev server running on http://localhost:3000 (LaunchAgent on Mac
 *     OR `npm run dev`).
 *   - Admin user seeded per `scripts/create-admin.ts`.
 *   - Postgres running with at least one operational company in the
 *     admin's org so the snapshot is not empty (empty snapshot is a
 *     legitimate but separate visual surface).
 *   - Optional: ANTHROPIC_API_KEY set for the AI narrative to render;
 *     when missing, the page renders with the i18n fallback headline
 *     and `narration-paragraphs` is absent — that branch has its own
 *     test in `NarrativeSection.test.tsx`. This smoke only asserts the
 *     surface that's always present (hero + metrics + trend chart +
 *     top alerts + footer).
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

test.describe('Phase 7.G LII smoke — Board Deck v2 layout', () => {
  test('admin opens /budgeting/board-deck, all v2 sections render', async ({
    page,
  }) => {
    // Snapshot build + AI narrative cache lookup can take 5-10s on a
    // cold cache, even more on first-ever LLM call. Cap at 60s — same
    // budget as the snapshot-card visual baseline spec.
    test.setTimeout(60_000);

    await loginAs(page);
    await page.goto('/budgeting/board-deck');

    // Hero is the load-bearing surface. If this fails, the page didn't
    // render at all (or `requireAuth` rejected). 30s timeout absorbs
    // first-time narrative cache miss.
    const hero = page.getByTestId('board-deck-hero');
    await expect(hero).toBeVisible({ timeout: 30_000 });

    // Hero subcomponents — locks the Turn-XLVIII contract.
    await expect(page.getByTestId('hero-headline')).toBeVisible();
    await expect(page.getByTestId('hero-score')).toBeVisible();
    await expect(page.getByTestId('hero-cta')).toBeVisible();

    // Metrics row + trend chart — Turn XLIX contract.
    await expect(page.getByTestId('board-deck-metrics-row')).toBeVisible();
    await expect(page.getByTestId('composite-trend-chart')).toBeVisible();

    // Top alerts surface — Turn LI contract. Either the populated list
    // OR the all-clear empty state — the section root testid is the same.
    await expect(page.getByTestId('board-deck-top-alerts')).toBeVisible();

    // Footer actions — Turn LI contract. Always present (no empty state).
    const footer = page.getByTestId('board-deck-footer-actions');
    await expect(footer).toBeVisible();
    await expect(footer.getByTestId('footer-terminal-link')).toBeVisible();
  });
});
