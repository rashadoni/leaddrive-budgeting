/**
 * Phase A step 2 Path B — load real BudgetLine data from AZMADE's xlsx
 * budgets into the dev DB.
 *
 * For each (file, sheet → target company) mapping below:
 *   1. Parse the SOPL sheet with `parseSoplSheet` from `azmade-sopl.ts`.
 *   2. Ensure a `ChartOfAccount` row exists for every unique KOD encountered
 *      — created on-fly with `accountType` derived from the prefix (`AGRO_*`
 *      / `IND_*` indicator seeds already ship this convention).
 *   3. Ensure a `BudgetPlan` exists for the target company + year (create a
 *      thin record if missing).
 *   4. Upsert one `BudgetLine` per parsed row with `plannedAmount` = annual
 *      sum of the 12 months and `accountId` pointing at the CoA row.
 *
 * Idempotent — re-running produces the same output. Lines with matching
 * `(planId, code, companyId)` are updated in place.
 *
 * Run:
 *   npx tsx scripts/import-azmade-budgets.ts
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import {
  parseSoplSheet,
  parseSummaryRollupSheet,
  type ParsedBudgetLine,
} from '../src/lib/onboarding/adapters/azmade-sopl';
import { runRecomputeForCompanies } from '../src/lib/risk/recompute-trigger';
import { logImportBudgetCreate } from '../src/lib/audit/import-helpers';

const prisma = new PrismaClient();

// Where the xlsx files live on the dev machine.
const BUDGETS_DIR = '/Users/rashadrahimov/Documents/budgets azmade';

type ImportJob = {
  file: string;
  sheet: string;
  companyCode: string; // must resolve within azmade org
  year: number;
  /** When present, use the summary-rollup parser (5-2 sheet) instead of the
   *  SOPL leaf parser. The column in the sheet with this header is the
   *  entity we're importing into (e.g. "Mərkəz" for ATL-MRKZ). */
  rollupColumnHeader?: string;
};

// rev6/7/8 each hold a SOPL of a single sub-group. rev9-ATL is consolidated
// across ATL children via per-entity sheets ("SOPL P-F DBZ 2026" etc). We
// skip rev9-ATL in this first pass — the "P-F" sheet structure is Plan vs
// Fact with wider column counts and needs its own adapter tuning. Adds in a
// follow-up once the 4 simpler sub-group imports are green.
const JOBS: ImportJob[] = [
  { file: 'rev6 - 2026 Budget - LLS.xlsx', sheet: 'SOPL', companyCode: 'LLS-MAIN', year: 2026 },
  { file: 'rev7 - 2026 Budget - -SPARK.xlsx', sheet: 'SOPL', companyCode: 'SPARK-MAIN', year: 2026 },
  { file: 'rev8 - 2026 Budget - ZTP.xlsx', sheet: 'SOPL', companyCode: 'ZTP-MAIN', year: 2026 },
  // ATL rev9 — per-entity SOPL P-F (Plan-Fact) sheets. Adapter picks the
  // Plan column only (Fakt / Fərq / % columns are skipped).
  { file: 'rev 9 - 2026 Budget - ATL.xlsx', sheet: 'SOPL P-F DBZ 2026', companyCode: 'ATL-DBZ', year: 2026 },
  { file: 'rev 9 - 2026 Budget - ATL.xlsx', sheet: 'SOPL P-F PMZ 2026', companyCode: 'ATL-PMZ', year: 2026 },
  { file: 'rev 9 - 2026 Budget - ATL.xlsx', sheet: 'SOPL P-F TAZ 2026', companyCode: 'ATL-TAZ', year: 2026 },
  // ATL-MRKZ — no per-entity P-F sheet for 2026, only the 5-2 consolidated
  // rollup. `parseSummaryRollupSheet` extracts annual rollups from the
  // entity column identified by `rollupColumnHeader`.
  {
    file: 'rev 9 - 2026 Budget - ATL.xlsx',
    sheet: '5-2 2026 büdcə mrkz daxil',
    companyCode: 'ATL-MRKZ',
    year: 2026,
    rollupColumnHeader: 'Mərkəz',
  },
  // AAC — standalone budget file from Downloads (user supplied 2026-04-24).
  // Uses the `P&L` sheet with KOD in col A, AZ label in col B, source hint
  // in col C, then **English month abbreviations** Jan..Dec in cols D..O.
  // Parser handles both AZ and EN month headers via `MONTH_ALIASES`.
  // Turn 29: companyCode reverted to `AAC-MAIN` — AAC restored to level=1
  // sub-group wrapper with AAC-MAIN level=2 operational child. xlsx S-1..S-6
  // are PRODUCT lines (MHB / burnt lime / slaked lime / glue / U-block /
  // waste lime sales forecasts), not company subsidiaries — so AAC-MAIN
  // remains the single op entity owning the imported BudgetLines.
  {
    file: '/Users/rashadrahimov/Downloads/2026 Budget - AAC.xlsx',
    sheet: 'P&L',
    companyCode: 'AAC-MAIN',
    year: 2026,
  },
];

async function ensureChartOfAccountTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  code: string,
  label: string,
  accountType: string,
  cache: Map<string, string>,
): Promise<string> {
  if (cache.has(code)) return cache.get(code)!;

  const existing = await tx.chartOfAccount.findUnique({
    where: { organizationId_code: { organizationId, code } },
    select: { id: true },
  });
  if (existing) {
    cache.set(code, existing.id);
    return existing.id;
  }

  const created = await tx.chartOfAccount.create({
    data: {
      organizationId,
      code,
      name: label || code,
      nameEn: label || code,
      accountType,
      sortOrder: 0,
      isActive: true,
    },
    select: { id: true },
  });
  cache.set(code, created.id);
  return created.id;
}

async function ensureBudgetPlanTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  year: number,
): Promise<{ id: string; created: boolean }> {
  // BudgetPlan is org-wide, not company-scoped — one plan per org per year.
  // Multiple companies share the same plan row; BudgetLine.companyId is what
  // attributes lines to individual companies within a plan.
  // Inside the import transaction so a plan row never outlives a failed
  // import — ACID rollback unwinds it alongside the BudgetLine writes.
  const name = `AZMADE ${year} Budget`;
  const existing = await tx.budgetPlan.findFirst({
    where: { organizationId, year, name, deletedAt: null },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await tx.budgetPlan.create({
    data: {
      organizationId,
      name,
      year,
      periodType: 'yearly',
      status: 'active',
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function insertBudgetLineTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  planId: string,
  companyId: string,
  accountId: string,
  parsed: ParsedBudgetLine,
  // Phase 7.G Turn XXXIX (L1 closure): tag every BudgetLine with the
  // company's baseCurrencyCode. AZMADE companies are all `AZN`, but
  // threading the value (with `'AZN'` fallback) keeps the script
  // future-proof if a non-AZN company is ever onboarded via this path.
  baseCurrencyCode: string | null,
): Promise<void> {
  // lineType tracks accountType — revenue/cogs map 1:1, everything else
  // (expense / asset / liability / equity) falls to "expense" for the
  // legacy column shape.
  const lineType =
    parsed.accountType === 'revenue' || parsed.accountType === 'cogs'
      ? parsed.accountType
      : 'expense';

  // Turn 34 (monthly distribution fix): write 12 rows per parsed line —
  // one per month (Jan..Dec) — with `plannedAmount` = perMonth value and
  // `sortOrder` = month-index encoded as `sortOrder % 100` per
  // `pnl/route.ts:144-149` aggregation logic. Single-row pre-Turn-34
  // imports collapsed all 12 months into Jan (sortOrder=0), so PNL chart
  // showed annual revenue spike in January only and zero across Feb-Dec.
  // Now PNL `monthlyAmounts[1..12]` populates correctly from monthly
  // values the parser already extracts but persistence used to drop.
  // The `perMonth` array is guaranteed length=12 (parser contract); for
  // rollup-sourced lines it's `annual/12` even split (parser doesn't have
  // monthly granularity for those — same as pre-fix behavior, but at
  // least distributed across all 12 months instead of crammed in Jan).
  for (let monthIdx = 0; monthIdx < 12; monthIdx += 1) {
    const monthlyAmount = parsed.perMonth[monthIdx] ?? 0;
    await tx.budgetLine.create({
      data: {
        organizationId,
        planId,
        companyId,
        accountId,
        category: parsed.code, // legacy column — keep in sync with account.code
        department: null,
        lineType,
        plannedAmount: monthlyAmount,
        sortOrder: monthIdx, // % 100 → month - 1 in PNL aggregation
        // Turn 29 (Bug #1b): xlsx-sourced lines have explicit plannedAmount
        // values; they are NOT auto-planned. Schema default is now false too.
        isAutoPlanned: false,
        isAutoActual: false,
        // Phase 7.G Turn XXXIX: tag with the company's base currency so
        // FX_IMPORTED_INPUT (and any future per-currency indicator) can
        // distinguish imported lines from base-currency lines.
        currencyCode: baseCurrencyCode ?? 'AZN',
      },
    });
  }
}

async function runJob(
  org: { id: string },
  job: ImportJob,
): Promise<{
  inserted: number;
  deleted: number;
  warnings: number;
  companyId: string;
  year: number;
}> {
  // Absolute path in `file` overrides BUDGETS_DIR — useful when a single
  // workbook lives outside the main budgets folder (e.g. AAC from Downloads).
  const fullPath = job.file.startsWith('/')
    ? job.file
    : `${BUDGETS_DIR}/${job.file}`;
  console.log(`\n→ ${job.file} [sheet="${job.sheet}"] → ${job.companyCode} / ${job.year}`);

  const company = await prisma.company.findUnique({
    where: { organizationId_code: { organizationId: org.id, code: job.companyCode } },
    // baseCurrencyCode is the org-level default for the company. Phase 7.G
    // Turn XXXIX (L1 closure) — pass through to BudgetLine.currencyCode so
    // FX_IMPORTED_INPUT can detect imported (non-base) cost lines correctly.
    // Pre-Turn-XXXIX behavior: BudgetLine.currencyCode landed as NULL,
    // making FX_IMPORTED_INPUT structurally return 0% for AZMADE — the
    // architect-flagged "fake green" that originally retired IND_FX_INPUT_RISK.
    select: { id: true, baseCurrencyCode: true },
  });
  if (!company) {
    throw new Error(`Company "${job.companyCode}" not found in org — run seed-azmade-holding first.`);
  }

  // Parse OUTSIDE the transaction — if the workbook is malformed we want
  // to fail fast without holding a long-running DB lock.
  const wb = XLSX.readFile(fullPath, { cellFormula: false, cellHTML: false });
  const parsed = job.rollupColumnHeader
    ? parseSummaryRollupSheet(wb, job.sheet, job.rollupColumnHeader, XLSX)
    : parseSoplSheet(wb, job.sheet, XLSX);

  if (parsed.warnings.length > 0) {
    for (const w of parsed.warnings.slice(0, 5)) {
      console.log(`  ⚠ R${w.row}: ${w.reason}`);
    }
    if (parsed.warnings.length > 5) {
      console.log(`  ⚠ (+${parsed.warnings.length - 5} more warnings)`);
    }
  }
  if (parsed.parentRollupsDropped.length > 0) {
    // Parent-rollup dedup is intentional (see `dedupeParentRollups` jsdoc),
    // not a warning — but finance wants visibility into what got removed so
    // discrepancies against the raw sheet aren't a mystery.
    const sample = parsed.parentRollupsDropped.slice(0, 3);
    console.log(
      `  i dropped ${parsed.parentRollupsDropped.length} parent rollup code(s) — leaf children carry the real amounts. e.g. ${sample.map((d) => `${d.code}(${d.plannedAnnual.toFixed(0)})`).join(', ')}${parsed.parentRollupsDropped.length > 3 ? ', …' : ''}`,
    );
  }
  if (parsed.parentRollupsUnallocated.length > 0) {
    // Reconciliation guard caught a parent whose amount exceeded the sum of
    // its children by more than 1% — a synthetic `__UNALLOCATED__` leaf was
    // injected to preserve the delta. Finance should know this happened so
    // they can either (a) add the missing child lines to the source Excel or
    // (b) accept that the parent carried a legitimately un-broken-down
    // bucket. Warning-level since silent would be the unsafe alternative.
    const sample = parsed.parentRollupsUnallocated.slice(0, 3);
    console.log(
      `  ⚠ reconciliation: ${parsed.parentRollupsUnallocated.length} parent(s) exceeded sum of children; injected __UNALLOCATED__ leaves for delta. e.g. ${sample.map((u) => `${u.parentCode}→${u.plannedAnnual.toFixed(0)}`).join(', ')}${parsed.parentRollupsUnallocated.length > 3 ? ', …' : ''}`,
    );
  }

  // FINANCIAL SAFETY — transactional replace.
  // BudgetPlan lookup/create + full delete-then-insert for this (org, plan,
  // company) triple, all inside one $transaction. Re-uploads and edits
  // (rows renamed / removed / restructured in Excel) all converge to
  // exactly what's in the parsed file. If any step fails, Postgres ACID
  // rolls back the plan creation, the delete, and any partial inserts —
  // file either lands fully or the pre-existing state is untouched.
  const { deleted, inserted, planId, planCreated } = await prisma.$transaction(
    async (tx) => {
      const plan = await ensureBudgetPlanTx(tx, org.id, job.year);
      const del = await tx.budgetLine.deleteMany({
        where: {
          organizationId: org.id,
          planId: plan.id,
          companyId: company.id,
        },
      });
      const coaCache = new Map<string, string>();
      let ins = 0;
      for (const line of parsed.lines) {
        const accountId = await ensureChartOfAccountTx(
          tx,
          org.id,
          line.code,
          line.label,
          line.accountType,
          coaCache,
        );
        await insertBudgetLineTx(tx, org.id, plan.id, company.id, accountId, line, company.baseCurrencyCode);
        ins += 1;
      }
      return {
        deleted: del.count,
        inserted: ins,
        planId: plan.id,
        planCreated: plan.created,
      };
    },
    // 60s timeout — covers ~500 rows comfortably; adjust if a workbook
    // grows past that size.
    { timeout: 60_000 },
  );

  if (planCreated) {
    console.log(`  + BudgetPlan created: "AZMADE ${job.year} Budget" id=${planId}`);
  }

  console.log(
    `  ✓ ${job.companyCode.padEnd(12)} inserted=${inserted} deleted=${deleted} skipped=${parsed.skippedRowCount} warnings=${parsed.warnings.length}`,
  );

  // Per-company recompute + audit emission, mirroring the API route. Done
  // inline (not batched at end) so each `import_budget_create` audit row
  // carries its own recompute counters — matching the API metadata shape
  // exactly. Cost: 8 separate recompute calls instead of one batch, but
  // the underlying work is identical and the per-call overhead is dwarfed
  // by the per-company indicator math.
  const recomputeResult = await runRecomputeForCompanies(
    prisma,
    org.id,
    [{ companyId: company.id, year: job.year }],
    {
      pairError: (label, err) =>
        console.error(`  ✗ ${label}:`, err instanceof Error ? err.message : err),
    },
  );

  // Phase 7.F (Turn 19) — emit audit event so CLI re-runs leave the same
  // trail the API route produces. `actorUserId: null` renders as italic
  // "system" in `AuditFeed`. `parser` is derived from the JOB shape:
  // rollupColumnHeader present → 'rollup' (5-2 summary sheet), absent →
  // 'sopl' (line-item leaf sheet).
  const auditResult = await logImportBudgetCreate(prisma, {
    organizationId: org.id,
    actorUserId: null,
    planId,
    companyId: company.id,
    companyCode: job.companyCode,
    year: job.year,
    parser: job.rollupColumnHeader ? 'rollup' : 'sopl',
    inserted,
    deleted,
    warnings: parsed.warnings.length,
    parentRollupsDropped: parsed.parentRollupsDropped.length,
    parentRollupsUnallocated: parsed.parentRollupsUnallocated.length,
    recompute: {
      ok: recomputeResult.ok,
      unknown: recomputeResult.unknown,
      failed: recomputeResult.failed,
      targets: recomputeResult.targets,
    },
    context: { route: 'cli:import-azmade-budgets' },
  });
  if (!auditResult.ok) {
    console.error(
      `  ⚠ audit emission failed for ${job.companyCode}: ${auditResult.error}`,
    );
  }

  return {
    inserted,
    deleted,
    warnings: parsed.warnings.length,
    companyId: company.id,
    year: job.year,
  };
}

async function main() {
  const org = await prisma.organization.findUnique({
    where: { slug: 'azmade' },
    select: { id: true, name: true },
  });
  if (!org) {
    throw new Error('Organization slug="azmade" not found. Run seed-azmade-holding first.');
  }
  console.log(`Target org: ${org.name} (id=${org.id})`);

  let totalInserted = 0;
  let totalDeleted = 0;
  let totalWarnings = 0;
  for (const job of JOBS) {
    const result = await runJob(org, job);
    totalInserted += result.inserted;
    totalDeleted += result.deleted;
    totalWarnings += result.warnings;
  }

  const coaCount = await prisma.chartOfAccount.count({ where: { organizationId: org.id } });
  console.log('');
  console.log(
    `Summary: BudgetLine inserted=${totalInserted} (replaced ${totalDeleted} prior rows), ` +
      `ChartOfAccount rows in org=${coaCount}, total warnings=${totalWarnings}.`,
  );
  // Recompute + audit emission now happen per-job inside runJob so each
  // audit-row's recompute counters align 1:1 with its own import.
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
