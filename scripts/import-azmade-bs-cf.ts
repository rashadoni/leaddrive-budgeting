/**
 * Phase 7.G CXXXIV — extends import-azmade-budgets.ts to BS (SOFP) +
 * CF (CFS) sheets from the same 6 client xlsx files.
 *
 * After this script runs, the previously-empty Cash Flow / Balance Sheet
 * tabs in /budgeting will be populated with REAL client numbers (not
 * seed-azmade-rich.ts synthetic data).
 *
 * For each (file, sheet → target company) job below:
 *   1. Open the workbook + parse the sheet via the new SOFP / CFS adapters
 *   2. For each parsed line/entry, ensure a synthetic ChartOfAccount row
 *      exists (BS-* / CF-* prefixed)
 *   3. Replace existing rows for (planId, year) atomically inside one
 *      transaction so re-running converges to a consistent state
 *   4. balance_sheet_lines: 1 row per (parsed line × month) at sortOrder
 *      derived from month — same pattern as BudgetLine monthly distribution
 *   5. cash_flow_entries: 1 row per (parsed entry × month) with sign
 *      captured by entryType ("inflow"/"outflow") + activityType section
 *
 * Idempotent: each job's persistence step deletes-then-inserts within a
 * single transaction — no partial state on failure.
 *
 * Run: `npx tsx scripts/import-azmade-bs-cf.ts`
 *      (Falls back to `node` via the .cjs companion if tsx unavailable.)
 */

import { PrismaClient, type Prisma } from "@prisma/client"
import * as XLSX from "xlsx"
import { parseSofpSheet } from "../src/lib/onboarding/adapters/azmade-sofp"
import { parseCfsSheet } from "../src/lib/onboarding/adapters/azmade-cfs"

const prisma = new PrismaClient()
const ORG_SLUG = "azmade"
const BUDGETS_DIR = "/Users/rashadrahimov/Documents/budgets azmade"

interface BsCfJob {
  file: string
  /** Sheet name for SOFP (Balance Sheet); null to skip. */
  sofpSheet?: string
  /** Sheet name for CFS (Cash Flow Statement); null to skip. */
  cfsSheet?: string
  companyCode: string
  year: number
}

const JOBS: BsCfJob[] = [
  { file: "rev6 - 2026 Budget - LLS.xlsx", sofpSheet: "SOFP", cfsSheet: "CFS", companyCode: "LLS-MAIN", year: 2026 },
  { file: "rev7 - 2026 Budget - -SPARK.xlsx", sofpSheet: "SOFP", cfsSheet: "CFS", companyCode: "SPARK-MAIN", year: 2026 },
  { file: "rev8 - 2026 Budget - ZTP.xlsx", sofpSheet: "SOFP", cfsSheet: "CFS", companyCode: "ZTP-MAIN", year: 2026 },
  // ATL: only consolidated SOFP/CFS (attributed to ATL-MRKZ as central
  // entity) — per-entity DBZ/PMZ/TAZ drill-down deferred until
  // BalanceSheetLine + CashFlowEntry schemas gain a `companyId` field
  // (current schema is org-wide → per-entity rows would visually mix
  // and accountCode dedup wouldn't disambiguate cleanly).
  { file: "rev 9 - 2026 Budget - ATL.xlsx", sofpSheet: "SOFP", cfsSheet: "CFS", companyCode: "ATL-MRKZ", year: 2026 },
  // AAC — uses `BS` + `CF` sheet names (not SOFP/CFS). KNOWN LIMITATION:
  // AAC BS uses Excel date serials as headers (45657/46053/...) instead of
  // month-name strings. Current parser anchors on month-name detection and
  // will emit "No header row" warning + 0 rows for BS. CF works fine
  // (uses English month names Jan..Dec). Extending the parser to detect
  // consecutive Excel date serials in the right range is a follow-up.
  { file: "/Users/rashadrahimov/Downloads/2026 Budget - AAC.xlsx", sofpSheet: "BS", cfsSheet: "CF", companyCode: "AAC-MAIN", year: 2026 },
]

interface ResolvedRefs {
  orgId: string
  companyId: string
  planId: string
  baseCurrencyCode: string
}

async function ensureChartOfAccountTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  code: string,
  label: string,
  accountType: string,
  cache: Map<string, string>,
): Promise<string> {
  if (cache.has(code)) return cache.get(code)!
  const existing = await tx.chartOfAccount.findUnique({
    where: { organizationId_code: { organizationId, code } },
    select: { id: true },
  })
  if (existing) {
    cache.set(code, existing.id)
    return existing.id
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
  })
  cache.set(code, created.id)
  return created.id
}

async function resolveRefs(job: BsCfJob): Promise<ResolvedRefs> {
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true },
  })
  if (!org) throw new Error(`Org "${ORG_SLUG}" not found`)
  const company = await prisma.company.findUnique({
    where: { organizationId_code: { organizationId: org.id, code: job.companyCode } },
    select: { id: true, baseCurrencyCode: true },
  })
  if (!company) throw new Error(`Company "${job.companyCode}" not found`)
  const plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, year: job.year, deletedAt: null },
    select: { id: true },
  })
  if (!plan) throw new Error(`No BudgetPlan for org+${job.year} — run import-azmade-budgets first`)
  return {
    orgId: org.id,
    companyId: company.id,
    planId: plan.id,
    baseCurrencyCode: company.baseCurrencyCode || "AZN",
  }
}

async function processBsForJob(job: BsCfJob, refs: ResolvedRefs, fullPath: string): Promise<{ inserted: number; deleted: number; warnings: number }> {
  if (!job.sofpSheet) return { inserted: 0, deleted: 0, warnings: 0 }
  const wb = XLSX.readFile(fullPath, { cellFormula: false, cellHTML: false })
  const parsed = parseSofpSheet(wb, job.sofpSheet, XLSX)
  if (parsed.warnings.length > 0) {
    for (const w of parsed.warnings.slice(0, 5)) console.log(`    ⚠ BS R${w.row}: ${w.reason}`)
  }
  if (parsed.lines.length === 0) {
    console.log(`    ↪ BS: 0 lines parsed (skipping)`)
    return { inserted: 0, deleted: 0, warnings: parsed.warnings.length }
  }

  // CXXXVIII fix: prefix accountCode with companyCode so each company's BS
  // rows coexist in the org-wide table (BalanceSheetLine has no companyId
  // discriminator). Without this, sequential job runs would all delete each
  // other's rows on every job. Format: `BS-<COMPANY>-<slug>` (e.g.
  // `BS-LLS-MAIN-pul-ve-pul-vesaiti`). UI sorts by accountCode so rows from
  // the same company stay grouped.
  const codePrefix = `BS-${job.companyCode}-`
  const result = await prisma.$transaction(async (tx) => {
    const coaCache = new Map<string, string>()
    // Scoped delete: only THIS company's BS rows for this plan+year
    const del = await tx.balanceSheetLine.deleteMany({
      where: {
        planId: refs.planId,
        year: job.year,
        accountCode: { startsWith: codePrefix },
      },
    })
    const rows: Prisma.BalanceSheetLineCreateManyInput[] = []
    for (const line of parsed.lines) {
      // Original parser code is `BS-<slug>`; rewrite as `BS-<company>-<slug>`
      const scopedCode = codePrefix + line.code.replace(/^BS-/, "")
      const accountId = await ensureChartOfAccountTx(
        tx,
        refs.orgId,
        scopedCode,
        `${job.companyCode}: ${line.label}`,
        line.lineType,
        coaCache,
      )
      for (let m = 0; m < 12; m++) {
        rows.push({
          organizationId: refs.orgId,
          planId: refs.planId,
          accountCode: scopedCode,
          accountName: line.label, // raw AZ label without company prefix (UI shows code separately)
          accountId,
          lineType: line.lineType,
          subType: line.subType ?? null,
          year: job.year,
          month: m + 1,
          amount: line.perMonth[m],
        })
      }
    }
    if (rows.length > 0) await tx.balanceSheetLine.createMany({ data: rows })
    return { inserted: rows.length, deleted: del.count }
  })
  return { inserted: result.inserted, deleted: result.deleted, warnings: parsed.warnings.length }
}

async function processCfForJob(job: BsCfJob, refs: ResolvedRefs, fullPath: string): Promise<{ inserted: number; deleted: number; warnings: number }> {
  if (!job.cfsSheet) return { inserted: 0, deleted: 0, warnings: 0 }
  const wb = XLSX.readFile(fullPath, { cellFormula: false, cellHTML: false })
  const parsed = parseCfsSheet(wb, job.cfsSheet, XLSX)
  if (parsed.warnings.length > 0) {
    for (const w of parsed.warnings.slice(0, 5)) console.log(`    ⚠ CF R${w.row}: ${w.reason}`)
  }
  if (parsed.entries.length === 0) {
    console.log(`    ↪ CF: 0 entries parsed (skipping)`)
    return { inserted: 0, deleted: 0, warnings: parsed.warnings.length }
  }

  // CXXXVIII fix: scope delete to THIS company via sourceId prefix so
  // sequential job runs don't wipe each other. sourceId format:
  // `<companyId>:<code>:<month>`. Replaces prior `WHERE org+year+source` which
  // wiped across all companies.
  const sourceIdPrefix = `${refs.companyId}:`
  const result = await prisma.$transaction(async (tx) => {
    const del = await tx.cashFlowEntry.deleteMany({
      where: {
        organizationId: refs.orgId,
        year: job.year,
        source: "xlsx_import",
        sourceId: { startsWith: sourceIdPrefix },
      },
    })
    const rows: Prisma.CashFlowEntryCreateManyInput[] = []
    for (const entry of parsed.entries) {
      for (let m = 0; m < 12; m++) {
        const amount = entry.perMonth[m]
        if (amount === 0) continue // skip zero months
        rows.push({
          organizationId: refs.orgId,
          year: job.year,
          month: m + 1,
          entryType: entry.entryType,
          source: "xlsx_import",
          sourceId: `${sourceIdPrefix}${entry.code}:${m + 1}`,
          amount,
          currencyCode: refs.baseCurrencyCode,
          description: `${job.companyCode}: ${entry.label}`,
          activityType: entry.activityType === "opening_balance" ? "operating" : entry.activityType,
          category: `${job.companyCode}: ${entry.label}`,
          isProjected: true,
        })
      }
    }
    if (rows.length > 0) await tx.cashFlowEntry.createMany({ data: rows })
    return { inserted: rows.length, deleted: del.count }
  })
  return { inserted: result.inserted, deleted: result.deleted, warnings: parsed.warnings.length }
}

async function main() {
  console.log(`\n=== AZMADE BS+CF import (${JOBS.length} files) ===`)
  let totalBsLines = 0
  let totalCfEntries = 0

  for (const job of JOBS) {
    const fullPath = job.file.startsWith("/") ? job.file : `${BUDGETS_DIR}/${job.file}`
    console.log(`\n→ ${job.file} → ${job.companyCode} / ${job.year}`)
    let refs: ResolvedRefs
    try {
      refs = await resolveRefs(job)
    } catch (e: unknown) {
      console.log(`  ✗ ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    try {
      const bs = await processBsForJob(job, refs, fullPath)
      console.log(`  ✓ BS: ${bs.inserted} rows inserted (${bs.deleted} deleted, ${bs.warnings} warnings)`)
      totalBsLines += bs.inserted
    } catch (e: unknown) {
      console.log(`  ✗ BS error: ${e instanceof Error ? e.message : String(e)}`)
    }
    try {
      const cf = await processCfForJob(job, refs, fullPath)
      console.log(`  ✓ CF: ${cf.inserted} entries inserted (${cf.deleted} deleted, ${cf.warnings} warnings)`)
      totalCfEntries += cf.inserted
    } catch (e: unknown) {
      console.log(`  ✗ CF error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log(`\n=== DONE: ${totalBsLines} BS rows + ${totalCfEntries} CF entries ===`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
