/**
 * Phase 7.G Turn D.2 — Onboarding wizard E2E smoke.
 *
 * Locks the customer-facing AI Data Mapper flow at /budgeting/onboarding.
 * Vitest already covers the state machine + button gating + error
 * branches under happy-dom (`ImportWizard.test.tsx`, 13 cases).
 * Playwright adds what vitest can't:
 *   - Real browser file-input + multipart upload mechanics
 *   - Real auth-cookied API call to /api/onboarding/import/analyze
 *   - Real network response handling (vs mocked fetch)
 *
 * Test scope (4 cases):
 *   1. Auth-gate regression — unauth /budgeting/onboarding redirects to /login
 *   2. Wizard renders 3-step indicator + Step 1 form for authenticated user
 *   3. Form gating — Analyze button disabled until both companyId + file set
 *   4. (LLM-gated) Real Analyze submit → Step 2 transition + AI proposal
 *      renders. Skipped when E2E_SKIP_LLM=true (CI default to avoid LLM
 *      cost + non-determinism); runs locally when ANTHROPIC_API_KEY is
 *      set in the dev server's env.
 */

import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { loginAs } from '../fixtures/auth';

const FIXTURE_XLSX = path.resolve(__dirname, '../fixtures/test-budget.xlsx');

test.describe('Phase 7.G smoke — onboarding wizard', () => {
  test('auth-gate: unauth /budgeting/onboarding redirects to /login', async ({ page }) => {
    // Locks the customer-facing route against accidental public-route
    // regression. Mirrors terminal smoke pattern.
    await page.goto('/budgeting/onboarding');
    expect(page.url()).toMatch(/\/login/);
    await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 5_000 });
  });

  // SKIPPED 2026-06-03: the 3-step ImportWizard these next three tests target
  // was replaced by the tabbed `OnboardingTabbedPage` redesign — the
  // `ImportWizard.tsx` component (and its "1. Upload / 2. Review / 3. Applied"
  // StepIndicator + "Analyze with AI" Step-1 form) is DELETED. These specs
  // assert removed UI and can never pass as written; they are dead, not flaky.
  // TODO: rewrite against `src/features/onboarding/components/OnboardingTabbedPage.tsx`.
  // The auth-gate test above is still live.
  test.skip('wizard renders 3-step indicator + Step 1 form for authenticated admin', async ({ page }) => {
    await loginAs(page);
    await page.goto('/budgeting/onboarding');

    // Step indicator — matches StepIndicator at ImportWizard.tsx:301-332
    // which renders "1. Upload" / "2. Review" / "3. Applied".
    await expect(page.getByText(/1\.\s*Upload/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/2\.\s*Review/i)).toBeVisible();
    await expect(page.getByText(/3\.\s*Applied/i)).toBeVisible();

    // Step 1 form: company picker + file input + industry hint + sheet name.
    await expect(page.getByLabel(/Target company/i)).toBeVisible();
    await expect(page.getByLabel(/Industry hint/i)).toBeVisible();
    await expect(page.getByLabel(/Sheet name/i)).toBeVisible();
    await expect(page.getByLabel(/xlsx file/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Analyze with AI/i }),
    ).toBeVisible();
  });

  // SKIPPED — see note above (tests the deleted 3-step ImportWizard Step-1 form).
  test.skip('Step 1 form gating: Analyze button disabled until companyId + file both set', async ({ page }) => {
    await loginAs(page);
    await page.goto('/budgeting/onboarding');

    const analyzeBtn = page.getByRole('button', { name: /Analyze with AI/i });
    await expect(analyzeBtn).toBeVisible({ timeout: 10_000 });

    // Initially disabled (no company, no file).
    await expect(analyzeBtn).toBeDisabled();

    // Wait for the company dropdown to populate from /api/companies.
    // The select renders "— pick a company —" placeholder + N option rows;
    // we wait for the second-or-later option to appear (any operational co).
    const companySelect = page.getByLabel(/Target company/i);
    await expect
      .poll(async () => {
        const optionCount = await companySelect
          .locator('option')
          .count();
        return optionCount;
      }, { timeout: 10_000 })
      .toBeGreaterThan(1);

    // Pick the first non-placeholder option by value (any operational co).
    const firstOptionValue = await companySelect
      .locator('option')
      .nth(1)
      .getAttribute('value');
    expect(firstOptionValue).toBeTruthy();
    await companySelect.selectOption(firstOptionValue!);

    // Still disabled — no file yet.
    await expect(analyzeBtn).toBeDisabled();

    // Provide the file via the standard file input (not via the
    // file-picker dialog, which Playwright can't see).
    const fileInput = page.getByLabel(/xlsx file/i);
    await fileInput.setInputFiles(FIXTURE_XLSX);

    // Now BOTH conditions met → button enabled.
    await expect(analyzeBtn).toBeEnabled();
  });

  // LLM-gated full-flow test. Defaults to RUN locally (where dev server
  // typically has ANTHROPIC_API_KEY); set E2E_SKIP_LLM=true on CI or any
  // env where LLM cost / non-determinism is unwanted.
  // SKIPPED — see note above (tests the deleted 3-step ImportWizard analyze flow).
  test.skip('full flow: submit Analyze → Step 2 review with AI proposal (LLM-gated)', async ({ page }) => {
    test.skip(
      process.env.E2E_SKIP_LLM === 'true',
      'E2E_SKIP_LLM=true — full LLM-driven happy-path skipped (CI mode)',
    );

    await loginAs(page);
    await page.goto('/budgeting/onboarding');

    const companySelect = page.getByLabel(/Target company/i);
    await expect
      .poll(async () => companySelect.locator('option').count(), {
        timeout: 10_000,
      })
      .toBeGreaterThan(1);
    const firstOptionValue = await companySelect
      .locator('option')
      .nth(1)
      .getAttribute('value');
    await companySelect.selectOption(firstOptionValue!);

    // Pick a sheet name that matches the fixture (saves the AI from
    // having to guess multi-sheet — fixture has only "P&L" sheet but
    // server will probe sheet-name even with single-sheet xlsx).
    await page.getByLabel(/Sheet name/i).fill('P&L');

    await page.getByLabel(/xlsx file/i).setInputFiles(FIXTURE_XLSX);

    // Submit + wait for Step 2 transition. AI call typically takes
    // 5-15s; pad timeout to 30s.
    await page.getByRole('button', { name: /Analyze with AI/i }).click();

    // Step 2 has the unique "AI proposal" header (ImportWizard.tsx:547).
    // Generous timeout for the LLM round-trip.
    await expect(
      page.getByRole('heading', { name: /AI proposal/i }),
    ).toBeVisible({ timeout: 45_000 });

    // Sanity: the column-mapping table renders.
    await expect(page.getByText(/Columns \(\d+\)/)).toBeVisible();

    // Sanity: Apply button visible (Step 2 → 3 affordance).
    await expect(
      page.getByRole('button', { name: /Apply to BudgetLine/i }),
    ).toBeVisible();
    // We do NOT click Apply — that mutates real DB. Step 2 reach is the
    // smoke target; the Apply contract is covered by vitest's
    // ImportWizard.test.tsx case 8 (locks Step-2→Step-3 transition).
  });
});
