/**
 * Operator-driven workbook import via the real AI Auto Import route (2026-07-15).
 *
 * NOT part of the regular suite: strictly env-gated. Runs ONLY when
 * PROD_IMPORT_FILE (absolute xlsx path) and PROD_IMPORT_YEAR are set,
 * e.g.:
 *
 *   E2E_BASE_URL=http://46.225.60.142 \
 *   E2E_ADMIN_EMAIL=admin@fo.az E2E_ADMIN_PASSWORD=… \
 *   PROD_IMPORT_FILE="/path/to/workbook.xlsx" PROD_IMPORT_YEAR=2026 \
 *   PROD_IMPORT_APPLY=1 \
 *   npx playwright test e2e/smoke/prod-import.spec.ts
 *
 * Uses the login fixture for a session cookie, then POSTs multipart to
 * /api/import/ai-auto-multi — the exact path the UI upload takes (route-side
 * pre-splits, classification, reconciliation gates, recompute, audit event,
 * stale-sibling warnings all included). Logs the full receipt.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loginAs } from '../fixtures/auth';

const FILE = process.env.PROD_IMPORT_FILE ?? '';
const YEAR = process.env.PROD_IMPORT_YEAR ?? '';
const APPLY = process.env.PROD_IMPORT_APPLY === '1';

test.skip(
  !FILE || !YEAR,
  'env-gated operator tool — set PROD_IMPORT_FILE + PROD_IMPORT_YEAR to run',
);

test('AI auto-import workbook via route', async ({ page }) => {
  test.setTimeout(360_000);
  expect(fs.existsSync(FILE), `file exists: ${FILE}`).toBe(true);

  await loginAs(page);

  const res = await page.request.post('/api/import/ai-auto-multi', {
    timeout: 320_000,
    multipart: {
      files: {
        name: path.basename(FILE),
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: fs.readFileSync(FILE),
      },
      year: YEAR,
      apply: APPLY ? '1' : '0',
      allowYellow: '1',
    },
  });

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  console.log(`=== IMPORT ${APPLY ? 'APPLY' : 'PREVIEW'} year=${YEAR} — HTTP ${res.status()} ===`);
  if (!body) {
    console.log('(non-JSON response)');
  } else {
    console.log('ok:', body.ok, 'mode:', body.mode, 'verdict:', body.overallVerdict);
    const groups = (body.perGroup ?? []) as Array<Record<string, unknown>>;
    for (const g of groups) {
      console.log(
        `group ${g.fileType}: verdict=${g.verdict} committed=${g.committed} rows=${g.totalRowsInserted} skip=${g.skipReason ?? '-'}`,
      );
    }
    const receipt = body.safetyReceipt as Record<string, unknown> | undefined;
    if (receipt) {
      console.log(
        'receipt status:', receipt.status,
        '| rows:', JSON.stringify(receipt.rows),
        '| companies:', JSON.stringify(receipt.affectedCompanies),
        '| plans:', JSON.stringify(receipt.affectedPlans),
        '| recompute:', JSON.stringify(receipt.recompute),
      );
    }
    const warnings = (body.warnings ?? []) as string[];
    console.log(`warnings (${warnings.length}):`);
    for (const w of warnings.slice(0, 30)) console.log('  ⚠', w);
    const conflicts = (body.conflicts ?? []) as unknown[];
    if (conflicts.length > 0) {
      console.log(`CONFLICTS (${conflicts.length}):`, JSON.stringify(conflicts).slice(0, 2000));
    }
  }

  expect(res.status(), 'route accepted the import').toBe(200);
  expect(body?.ok, 'import ok').toBe(true);
});
