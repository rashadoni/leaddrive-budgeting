/**
 * Phase 7.I — AzerSheker pilot end-to-end smoke (2026-05-16).
 *
 * Walks through the customer-facing flow that proves the cane-grower
 * vertical is wired end-to-end:
 *
 *   1. /budgeting/admin/data-entry company dropdown has AZSEKER-EDEN
 *      (validates the flatten fix from commit f60ed27 that surfaced
 *      level-2 op-cos in the picker).
 *
 *   2. The metric/indicator dropdowns carry the 2026-05-16 UX polish:
 *      sector emoji prefix on operational rows + human-name-first on
 *      ESG rows (so labels aren't truncated by the column width).
 *
 *   3. /budgeting/terminal HeatMap, after selecting AZSEKER-EDEN in
 *      the CompanyTree, renders AGRO_* columns BEFORE universal
 *      financial columns (Track C.1 sector-aware sort).
 *
 *   4. /terminal-panel/commodity-ticker?company=AZSEKER-EDEN renders
 *      the real sugar price card + 3-region (Salyan / Imishli /
 *      Sabirabad) weather strip from the populated IntelDataPoint
 *      rows (Track B adapter ingest).
 *
 *   5. /budgeting/admin/drift renders the freshness card section so
 *      ops can see which adapters are fresh / stale.
 *
 * AI Explain is NOT in scope — requires ANTHROPIC_API_KEY which is
 * environment-gated. The variance-explainer handler.test.ts unit
 * already locks the company.settings forwarding.
 *
 * Visual regression is NOT in scope — covered by visual-baseline.spec.ts.
 *
 * What this spec DOES require to be in the DB:
 *   - 4 AZSEKER agro companies tagged industry=agro_crops with
 *     settings.region set
 *   - The 7 Phase 7.I AGRO_* indicator definitions (seed-indicators.ts)
 *   - At least one weather-openmeteo + sugar-yahoo-sb-f IntelDataPoint
 *     row (npx tsx scripts/ingest-commodity-once.ts)
 *
 * If any prerequisite is missing the spec FAILS LOUDLY rather than
 * silently passing on empty state — these are exactly the data-flow
 * gaps the pilot launch needs to catch.
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

test.describe('Phase 7.I AzerSheker pilot smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('data-entry company dropdown surfaces AZSEKER operational entities (not just sub-group parents)', async ({
    page,
  }) => {
    await page.goto('/budgeting/admin/data-entry');
    // Wait for the company <select> to be populated by the /api/companies
    // fetch — its options array starts with the placeholder "—" and
    // grows as the React Query resolves. Lock on AZSEKER-EDEN appearing
    // since that's the load-bearing assertion.
    await expect(page.locator('select').first().locator('option', { hasText: /AZSEKER-EDEN/ }))
      .toHaveCount(1, { timeout: 10_000 });

    const optionTexts = await page.locator('select').first().locator('option').allTextContents();
    // The load-bearing assertion: the 4 AZSEKER agro leaves appear
    // (these are the cane-grower entities the pilot targets).
    expect(optionTexts.join('|')).toContain('AZSEKER-EDEN');
    expect(optionTexts.join('|')).toContain('AZSEKER-FARM');
    expect(optionTexts.join('|')).toContain('AZSEKER-AZSF');
    expect(optionTexts.join('|')).toContain('AZSEKER-CPC');
    // At least one ATL leaf (level=2) — confirms flatten works across
    // multiple sub-groups, not just AZSEKER.
    expect(optionTexts.join('|')).toContain('ATL-DBZ');
    // Sub-group parents (level=1) also remain present.
    expect(optionTexts.join('|')).toContain('AZSEKER');
  });

  test('data-entry operational metric dropdown uses sector emoji prefix + range helper', async ({
    page,
  }) => {
    await page.goto('/budgeting/admin/data-entry');
    // The metric select is the second <select> AND is rendered server-
    // side from a static catalog — no fetch wait needed.
    await expect(page.locator('select').nth(1)).toBeVisible({ timeout: 10_000 });
    const metricOptions = await page.locator('select').nth(1).locator('option').allTextContents();
    const joined = metricOptions.join('|');
    // 2026-05-16 dropdown polish — at least one agro option carries
    // the 🌾 emoji + (unit) parens + [sector] bracket. Unit is the
    // metric rule's literal string ("tons/ha", "%", "hours", ...).
    expect(joined).toMatch(/🌾/);
    expect(joined).toMatch(/\(tons\/ha\)/); // yield_per_ha
    expect(joined).toMatch(/\[Agro\]/); // sector bracket
    // Helper line beneath the dropdown shows unit + range or hint.
    // Lock on the range/диапазон substring to stay locale-tolerant.
    await expect(page.getByText(/диапазон|range/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('data-entry ESG dropdown shows human-readable name first (not technical code first)', async ({
    page,
  }) => {
    await page.goto('/budgeting/admin/data-entry');
    // Switch to the ESG tab. The tab is a button with a count badge —
    // role+regex match for either locale.
    await expect(page.locator('select').first()).toBeVisible({ timeout: 10_000 });
    // Buttons with "ESG" text — there's only one tab carrying that letter combo.
    await page.locator('button', { hasText: /ESG/ }).first().click();
    // After tab switch the indicator select renders; it has only 4
    // ESG indicator options.
    const opts = await page.locator('select').nth(1).locator('option').allTextContents();
    const scope1 = opts.find((t) => t.includes('IND_CARBON_SCOPE_1'));
    expect(scope1).toBeTruthy();
    expect(scope1).toMatch(/🌱.*Scope 1/i);
    // The technical code is NOT at the start of the string.
    expect(scope1!.indexOf('IND_CARBON_SCOPE_1')).toBeGreaterThan(0);
  });

  test('terminal HeatMap renders AGRO_* columns before universal IND_* for active AZSEKER-EDEN', async ({
    page,
  }) => {
    await page.goto('/budgeting/terminal');
    // Click the AZSEKER-EDEN row in the CompanyTree to activate it.
    // CompanyTree rows expose `data-company-code` for stable selection.
    await page.locator('[data-company-code="AZSEKER-EDEN"]').first().click();

    // Wait for the matrix to settle — column headers carry
    // data-indicator-code (added in commit 07a2295).
    await page.locator('th[data-indicator-code]').first().waitFor({ state: 'visible' });

    const codes = await page
      .locator('th[data-indicator-code]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-indicator-code') ?? ''));

    expect(codes.length).toBeGreaterThan(5);

    // At least one AGRO_* code appears, and the FIRST AGRO_* index is
    // before the first universal IND_* (excluding the rollup-only
    // IND_HOLDING_REVENUE / IND_NET_MARGIN_VS_2025 which are placed by
    // their seed sortOrder).
    const firstAgroIdx = codes.findIndex((c) => c.startsWith('AGRO_'));
    const firstUniversalFinIdx = codes.findIndex(
      (c) =>
        c === 'IND_GROSS_MARGIN' || c === 'IND_NET_MARGIN' || c === 'IND_OPEX_RATIO' || c === 'IND_DSO',
    );

    expect(firstAgroIdx).toBeGreaterThanOrEqual(0);
    // If financial indicators ARE in the rendered set, AGRO_* must come first.
    if (firstUniversalFinIdx >= 0) {
      expect(firstAgroIdx).toBeLessThan(firstUniversalFinIdx);
    }
  });

  test('commodity-ticker pop-out renders real sugar price + 3-region weather strip', async ({
    page,
  }) => {
    await page.goto('/terminal-panel/commodity-ticker?company=AZSEKER-EDEN');

    // Sugar card heading.
    await expect(page.getByText(/ICE Sugar #11/i)).toBeVisible();
    // Adapter source code chip — confirms real-data path, not stub.
    await expect(page.getByText('sugar-yahoo-sb-f')).toBeVisible();

    // Latest sugar price has a $ prefix + digit. The exact value moves
    // with Yahoo data, so we only assert SHAPE, not the literal number.
    await expect(page.getByText(/^\$\d+(\.\d+)?$/).first()).toBeVisible();

    // Weather strip: all 3 configured Azerbaijani sugar-belt regions
    // present. Regions render as "Salyan" / "Imishli" / "Sabirabad"
    // (first letter capitalized in the panel).
    await expect(page.getByText(/Salyan/i)).toBeVisible();
    await expect(page.getByText(/Imishli/i)).toBeVisible();
    await expect(page.getByText(/Sabirabad/i)).toBeVisible();
    // Source attribution line for the weather card.
    await expect(page.getByText(/Open-Meteo archive/i)).toBeVisible();
  });

  test('drift dashboard renders reference-freshness cards from real adapter data', async ({ page }) => {
    await page.goto('/budgeting/admin/drift');

    // The freshness cards hydrate via React Query after the page mounts;
    // wait for one of the configured source codes to appear in the DOM
    // rather than reading initial SSR HTML.
    //
    // DEFAULT_SOURCES (src/lib/intel/freshness.ts) lists 6 monitored
    // adapters as of 2026-05-16: tcmb-fx-rates, worldbank-cpi,
    // commodities-rss-brent, weather-openmeteo, worldbank-sugar,
    // sugar-yahoo-sb-f. We assert against the three that have real
    // ingested rows (DB-state audit confirms): weather-openmeteo,
    // worldbank-cpi, sugar-yahoo-sb-f.
    await expect(page.getByText(/weather-openmeteo/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/worldbank-cpi/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/sugar-yahoo/i)).toBeVisible({ timeout: 15_000 });
  });
});
