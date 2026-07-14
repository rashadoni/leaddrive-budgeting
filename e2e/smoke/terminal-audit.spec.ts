/**
 * Risk Terminal functional audit (2026-07-15) — captures what is actually
 * broken on a freshly imported org: console errors, failed API calls, and
 * per-panel data presence. Written as a diagnostic spec: soft checks are
 * logged into one report so a single failure doesn't hide the rest.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from '../fixtures/auth';

function wireCapture(page: Page) {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return { consoleErrors, failedRequests };
}

function report(tag: string, consoleErrors: string[], failedRequests: string[]) {
  console.log(`--- [${tag}] console errors (${consoleErrors.length}):`);
  for (const e of [...new Set(consoleErrors)].slice(0, 20)) console.log('  ', e);
  console.log(`--- [${tag}] failed requests (${failedRequests.length}):`);
  for (const r of [...new Set(failedRequests)].slice(0, 20)) console.log('  ', r);
}

test('terminal audit — heatmap current year', async ({ page }) => {
  test.setTimeout(120_000);
  const { consoleErrors, failedRequests } = wireCapture(page);
  const matrixPayloadRef: { current: Record<string, unknown> | null } = { current: null };
  page.on('response', async (res) => {
    if (res.url().includes('/api/indicators/matrix') && res.status() === 200) {
      matrixPayloadRef.current = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    }
  });
  await loginAs(page);

  await page.goto('/budgeting/terminal');
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  console.log(
    '[matrix payload] period=',
    matrixPayloadRef.current?.period,
    'availableYears=',
    JSON.stringify(matrixPayloadRef.current?.availableYears ?? null),
  );

  // Switch the heatmap to the CURRENT fiscal year (2026) via the period chips.
  const chip2026 = page.getByRole('button', { name: /^2026/ }).first();
  if (await chip2026.isVisible().catch(() => false)) {
    await chip2026.click();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  }

  const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const statusLine = bodyText.match(/[●○◐]?\s*\d+G\s*\/\s*[▲△]?\s*\d+A\s*\/\s*[■□]?\s*\d+R\s*\/\s*[◇◆]?\s*\d+\?/)?.[0];
  console.log('=== TERMINAL 2026 AUDIT ===');
  console.log('[heatmap status counts]', statusLine ?? '(not found)');
  console.log('[body]', bodyText.slice(0, 1200));
  report('terminal', consoleErrors, failedRequests);

  await page.screenshot({ path: 'test-results/terminal-2026.png', fullPage: true });
  await expect(page.locator('body')).toContainText(/HEATMAP/i);
});

test('P&L tab — Actual vs Budget shows budget after import', async ({ page }) => {
  test.setTimeout(120_000);
  const { consoleErrors, failedRequests } = wireCapture(page);
  await loginAs(page);

  await page.goto('/budgeting?tab=pl');
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

  const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log('=== P&L AUDIT ===');
  const budgetIdx = bodyText.indexOf('BUDGET');
  console.log('[cards]', budgetIdx >= 0 ? bodyText.slice(budgetIdx, budgetIdx + 260) : '(BUDGET card not found)');
  const banner = bodyText.match(/Budget P&L rows are not available[^.]*\./)?.[0];
  console.log('[missing-banner]', banner ?? '(absent — good)');
  console.log('[body]', bodyText.slice(0, 900));
  report('pnl', consoleErrors, failedRequests);

  await page.screenshot({ path: 'test-results/pnl-audit.png', fullPage: true });
  await expect(page.locator('body')).toContainText(/P&L/i);
});
