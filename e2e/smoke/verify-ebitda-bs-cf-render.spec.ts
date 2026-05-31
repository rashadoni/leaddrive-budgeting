/**
 * Functional UI verification (2026-05-31) — proves this session's DATA fixes
 * actually reach the screen, with concrete aria/text evidence (no aesthetics).
 *
 * Backs three things the user asked to confirm after the EBITDA fix + the
 * BS/CF restore + the soft-delete double-count fix:
 *
 *   #2 Terminal HeatMap renders the CORRECTED EBITDA.
 *      EDEN IND_EBITDA_MARGIN was a bogus deeply-negative figure (the old
 *      "EDEN −738%" anomaly, status RED). It is now the source-faithful
 *      +169.77% → status GREEN. CPC is +9.29% (positive but below the green
 *      floor → RED). The HeatMap <td> exposes a stable, ARIA-readable label
 *      "<companyCode> <indicatorCode> <status> <shape>" (HeatMapCellTd:270),
 *      so we assert on STATUS — the visible consequence of the corrected value.
 *
 *   #1 Budgeting Balance-Sheet tab renders data (not the empty state). The
 *      AZSEKER 2026 Budget plan is plans[0] (the page default), and the BS
 *      restore put 251 live lines under it. "Total Assets" is a hardcoded
 *      English literal in BudgetBalanceSheet (locale-independent).
 *
 *   #1 Budgeting Cash-Flow tab renders the monthly table (not the empty
 *      Banknote card). 309 live CashFlowEntry rows for year 2026 → months
 *      populated → BudgetCashFlowTable (a real <table> with Inflows/Outflows
 *      columns; locale=en per playwright.config).
 *
 * NOT in scope (and why):
 *   - #3 AI briefs cite the corrected EBITDA — the brief reads the SAME
 *     IndicatorValue row this spec confirms (169.77 green), but generating a
 *     live brief needs ANTHROPIC_API_KEY (env-gated, like the pilot spec's
 *     AI-Explain exclusion). The variance/brief unit tests lock the forwarding.
 *   - Exact magnitudes (1.43B assets / 49M inflows) — the deletedAt:null fix
 *     that produces them is locked at the unit level (handler tests). This
 *     spec proves RENDER, not the figure, to stay non-brittle.
 *   - Aesthetics / layout — owner=user (visual-baseline.spec.ts covers drift).
 */

import { expect, test } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

test.describe('Data-fix UI verification — EBITDA + BS/CF render', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('#2 terminal HeatMap shows corrected EBITDA: EDEN GREEN (was bogus red), CPC RED', async ({
    page,
  }) => {
    await page.goto('/budgeting/terminal');
    // The HeatMap renders the ACTIVE company's row; activating a company via
    // the CompanyTree (data-company-code) loads its matrix. We check the two
    // EBITDA outcomes by activating each entity in turn.
    await page.locator('[data-company-code="AZSEKER-EDEN"]').first().click();

    // Wait for the matrix column headers (data-indicator-code, commit 07a2295).
    await page.locator('th[data-indicator-code]').first().waitFor({ state: 'visible' });

    // The EBITDA column must be present in the rendered matrix.
    await expect(page.locator('th[data-indicator-code="IND_EBITDA_MARGIN"]')).toHaveCount(1);

    // EDEN EBITDA = +169.77% → GREEN (was the bogus "−738%"-class red). The
    // corrected value flipped the cell. aria-label format (HeatMapCellTd:270):
    // "<co.code> <ind.code> <status> <shape> [suffix]".
    const edenEbitdaGreen = page.locator(
      'td[aria-label^="AZSEKER-EDEN IND_EBITDA_MARGIN green"]',
    );
    await expect(edenEbitdaGreen).toBeVisible();
    // Negative control: the OLD bogus value rendered RED. It must be gone.
    await expect(
      page.locator('td[aria-label^="AZSEKER-EDEN IND_EBITDA_MARGIN red"]'),
    ).toHaveCount(0);

    // Activate CPC: its EBITDA = +9.29% (positive but below the green floor) →
    // RED. Confirms the source-faithful value (not the old net-margin collapse)
    // reached the UI for a second entity.
    await page.locator('[data-company-code="AZSEKER-CPC"]').first().click();
    await expect(
      page.locator('td[aria-label^="AZSEKER-CPC IND_EBITDA_MARGIN red"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('#1 budgeting Balance-Sheet tab renders data for the AZSEKER 2026 plan (not empty state)', async ({
    page,
  }) => {
    await page.goto('/budgeting?tab=balance-sheet');

    // Positive content marker — "Total Assets" is a hardcoded English literal
    // in BudgetBalanceSheet, rendered only when the BS query returns rows.
    await expect(page.getByText('Total Assets', { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    // The empty state must NOT be showing (it would mean BS lines are missing
    // for the default plan — the exact regression the restore fixed).
    await expect(page.getByText('No Balance Sheet data available')).toHaveCount(0);
  });

  test('#1 budgeting Cash-Flow tab renders the monthly table (not the empty Banknote card)', async ({
    page,
  }) => {
    await page.goto('/budgeting?tab=cash-flow');

    // The monthly CF table renders only when cashFlowData.months has data.
    // Its column header row carries Inflows + Outflows (locale=en).
    await expect(
      page.getByRole('columnheader', { name: /Inflows/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('columnheader', { name: /Outflows/i }),
    ).toBeVisible();

    // At least a few month rows present (12-month projection + total row).
    const rowCount = await page.locator('table tbody tr').count();
    expect(rowCount).toBeGreaterThanOrEqual(4);
  });
});
