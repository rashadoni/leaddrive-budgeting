#!/usr/bin/env tsx
/**
 * Phase 7.M Step 6 (2026-05-19) — AzerSheker workbook import via
 * the atomic `runImportBatch` wrapper.
 *
 * What this script does
 * ─────────────────────
 *   1. Open the AzerSheker financial workbook xlsx.
 *   2. For each operating entity (AZSF / CPC / EDEN / MALT), parse
 *      the P&L sheet via `parsePlfPlSheet` (P&L Phase A).
 *   3. Build one consolidated `ImportBatchPlan` carrying:
 *        • `rows[]`         — typed BudgetLine rows ready to insert
 *        • `expectedSums`   — sums per (entity, account, period)
 *                             computed during parsing
 *   4. Hand the plan to `runImportBatch`, which:
 *        • soft-archives prior live rows in scope
 *        • optionally purges previously-archived rows (true reset)
 *        • inserts new rows in a single transaction
 *        • triggers per-(entity, period) recompute
 *        • runs the reconciliation pass — exit code reflects the
 *          green/yellow/red verdict
 *
 * Usage:
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/import-azseker-workbook-batch.ts
 *
 * Flags:
 *
 *   --purge        Hard-delete archived rows in scope before write.
 *                  Use for a "clean re-import" that bounds the archive
 *                  tail. Default: keep archives (soft-delete only).
 *   --year=2026    Target year for the import. Default 2026.
 *   --entity=CODE  Run for one entity only (e.g. AZSEKER-AZSF). Useful
 *                  for incremental verification. Default: all 4.
 *   --dry-run      Parse + build the plan + print the would-be diff,
 *                  but skip the write & recompute. Reconciliation still
 *                  runs against the EXISTING DB state — useful to know
 *                  whether the live data already matches the file.
 *
 * Exit codes (matching `npm run smoke-test` convention):
 *   0 — reconciliation green / no drift
 *   1 — reconciliation yellow / sub-tolerance drift, demo OK with caveat
 *   2 — reconciliation red / structural mismatch, do NOT demo
 *   3 — fatal error before reconciliation could run
 */
import { PrismaClient } from "@prisma/client"
import * as XLSX from "xlsx"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"
import {
  parsePlfPlSheet,
  parsePlfCfSheet,
} from "@/lib/onboarding/adapters/azseker-plf"
import { parseWorkbookBsSheet } from "@/lib/onboarding/adapters/azseker-workbook-bs"
import {
  parseWorkbookFarmingKpiSheet,
  parseWorkbookProcessingKpiSheet,
} from "@/lib/onboarding/adapters/azseker-workbook-kpi"
import {
  parseFarmingSalesSheet,
  parseProductionSalesSheet,
  parseProMaltSalesSheet,
} from "@/lib/onboarding/adapters/azseker-workbook-sales"
import {
  runImportBatch,
  type ImportBatchPlan,
  type ImportBatchRow,
} from "@/lib/onboarding/import-batch"
import {
  runBalanceSheetBatch,
  type BsImportPlan,
  type BsImportRow,
} from "@/lib/onboarding/bs-import-batch"
import {
  runKpiBatch,
  type KpiImportPlan,
  type KpiImportRow,
} from "@/lib/onboarding/kpi-import-batch"
import {
  runCashFlowBatch,
  type CfImportPlan,
  type CfImportRow,
} from "@/lib/onboarding/cf-import-batch"
import {
  buildReconKey,
  formatReconciliationSummary,
  type ReconciliationKey,
} from "@/lib/onboarding/reconciliation"

// Phase 7.M Tier 3 (2026-05-19): Source workbook updated to the newer
// "Guvven Fin.xlsx" (May 19) which carries:
//   • All 4 entity P&L/BS/CF sheets (same as old)
//   • NEW sheet "Təsvir" — strategic descriptions per entity
//   • NEW section markers "Actual >>>" / "KPI >>>" — 2025 actuals + Brix/Pol
//   • NEW sheets "CAPEX_Farm" / "CAPEX_CPC" — 2026 CAPEX plan
//   • Possibly NEW "PL Farm / BS Farm / CF Farm" sheets — needs verification
// The older "Copy of Guvven Fin.xlsx" remains on disk for diff/audit.
const FILE =
  "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const ORG_SLUG = "azmade"
const DEFAULT_PLAN_NAME = "Azərşəkər 2026 Budget"

// Phase 7.M (2026-05-19, Azik confirmation):
//   • 4 entities have P&L / BS / CF sheets in the workbook
//   • ProMalt Sales attribute to AZSEKER-PROMALT (Promalt MMC, a
//     separate legal entity that handles malt sales). Its P&L / BS /
//     CF are NOT in this workbook — only its sales data.
//   • AZSEKER-FARM doesn't exist as a legal entity.
//   • AZSEKER-HORIZON intentionally empty (no data yet).
const ENTITIES = [
  { code: "AZSEKER-CPC", plSheet: "PLF CPC", bsSheet: "BS CPC", cfSheet: "CF CPC" },
  { code: "AZSEKER-AZSF", plSheet: "PLF AZSF", bsSheet: "BS AZSF", cfSheet: "CF AZSF" },
  { code: "AZSEKER-EDEN", plSheet: "PLF EDEN", bsSheet: "BS EDEN", cfSheet: "CF EDEN" },
  { code: "AZSEKER-MALT", plSheet: "PL Malt", bsSheet: "BS Malt", cfSheet: "CF Malt" },
]

const CF_SOURCE_TAG = "azseker-workbook-cf"

interface Args {
  purge: boolean
  year: number
  entityFilter: string | null
  dryRun: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  return {
    purge: argv.includes("--purge"),
    year:
      Number(
        argv.find((a) => a.startsWith("--year="))?.split("=")[1] ?? "2026",
      ) || 2026,
    entityFilter:
      argv.find((a) => a.startsWith("--entity="))?.split("=")[1] ?? null,
    dryRun: argv.includes("--dry-run"),
  }
}

async function main(): Promise<number> {
  const args = parseArgs()
  const prisma = new PrismaClient()
  try {
    console.log("=".repeat(72))
    console.log(
      `AzerSheker workbook import · year=${args.year} · purge=${args.purge} · dryRun=${args.dryRun}`,
    )
    if (args.entityFilter) console.log(`Entity filter: ${args.entityFilter}`)
    console.log("=".repeat(72))

    // Org + entities.
    const org = await prisma.organization.findFirst({
      where: { slug: ORG_SLUG },
      select: { id: true, name: true },
    })
    if (!org) throw new Error(`Org "${ORG_SLUG}" not found`)
    console.log(`Org: ${org.name} (id=${org.id})`)

    const targetEntities = args.entityFilter
      ? ENTITIES.filter((e) => e.code === args.entityFilter)
      : ENTITIES
    if (targetEntities.length === 0)
      throw new Error(`No entities match filter "${args.entityFilter}"`)

    const companies = await prisma.company.findMany({
      where: {
        organizationId: org.id,
        code: { in: targetEntities.map((e) => e.code) },
      },
      select: { id: true, code: true },
    })
    const byCode = new Map(companies.map((c) => [c.code, c]))
    for (const ent of targetEntities) {
      if (!byCode.has(ent.code)) {
        throw new Error(`Company ${ent.code} not in DB — seed first`)
      }
    }

    // Plan — find or create.
    const planName = DEFAULT_PLAN_NAME
    let plan = await prisma.budgetPlan.findFirst({
      where: {
        organizationId: org.id,
        year: args.year,
        name: planName,
        deletedAt: null,
      },
      select: { id: true },
    })
    if (!plan) {
      plan = await prisma.budgetPlan.create({
        data: {
          organizationId: org.id,
          year: args.year,
          name: planName,
          periodType: "annual",
          status: "draft",
        },
        select: { id: true },
      })
      console.log(`✓ Plan created: "${planName}" (id=${plan.id})`)
    } else {
      console.log(`↪ Plan exists: "${planName}" (id=${plan.id})`)
    }

    // Read workbook.
    const wb = XLSX.readFile(FILE, {
      cellFormula: false,
      cellHTML: false,
      cellDates: false,
    })

    // Parse each entity's P&L sheet → typed rows + expected sums.
    const allRows: ImportBatchRow[] = []
    const expectedSums = new Map<ReconciliationKey, number>()
    let parsedLineCount = 0
    let skippedZeroLineCount = 0

    for (const ent of targetEntities) {
      const company = byCode.get(ent.code)!
      console.log(`\n→ Parsing ${ent.code} · sheet="${ent.plSheet}"`)
      const result = parsePlfPlSheet(wb, ent.plSheet, XLSX, {
        preferYear: args.year,
      })
      if (result.warnings.length > 0) {
        console.log(`  ⚠ ${result.warnings.length} warning(s):`)
        for (const w of result.warnings.slice(0, 3)) {
          console.log(`    row ${w.row}: ${w.reason}`)
        }
      }
      console.log(`  ${result.lines.length} leaf lines parsed`)

      for (const line of result.lines) {
        parsedLineCount += 1
        for (let m = 0; m < 12; m++) {
          const amount = line.perMonth[m]
          if (amount === 0) {
            skippedZeroLineCount += 1
            continue
          }
          const period = `${args.year}-${String(m + 1).padStart(2, "0")}`
          const row: ImportBatchRow = {
            companyId: company.id,
            category: `${ent.code}-${line.code}`,
            lineType: line.accountType,
            period,
            monthIndex: m,
            plannedAmount: amount,
            currencyCode: "AZN",
            exchangeRate: null,
            planId: plan.id,
            sourceCell: `Copy of Guvven Fin.xlsx#${ent.plSheet}!${line.code}@${period}`,
          }
          allRows.push(row)
          const key = buildReconKey(ent.code, row.category, period)
          expectedSums.set(key, (expectedSums.get(key) ?? 0) + amount)
        }
      }
    }
    console.log(
      `\nParsing complete: ${parsedLineCount} leaf lines, ${allRows.length} (entity,account,month) rows ready to write, ${skippedZeroLineCount} zero-amount cells skipped.`,
    )

    if (args.dryRun) {
      console.log("\n[dry-run] Skipping write. Sample of expected sums:")
      const sample = Array.from(expectedSums.entries()).slice(0, 6)
      for (const [k, v] of sample) {
        console.log(`  ${k}  →  ${v.toFixed(2)} AZN`)
      }
      console.log(`  ... +${Math.max(0, expectedSums.size - sample.length)} more`)
      // Build empty plan that does nothing but reconciles against current DB.
      const result = await runImportBatch(prisma, {
        organizationId: org.id,
        label: `dry-run · ${args.year}`,
        actorUserId: "system",
        sourceDocument: FILE,
        companyIds: targetEntities.map((e) => byCode.get(e.code)!.id),
        periodScope: [],
        rows: [],
        expectedSums,
      })
      console.log(
        "\n[dry-run] Reconciliation against current DB state (no changes were made):",
      )
      console.log(formatReconciliationSummary(result.reconciliation))
      return result.reconciliation.verdict === "green"
        ? 0
        : result.reconciliation.verdict === "yellow"
          ? 1
          : 2
    }

    // Build period scope = the 12 months × year (so the reset matches
    // exactly what we're about to overwrite).
    const periodScope = Array.from(
      { length: 12 },
      (_, m) => `${args.year}-${String(m + 1).padStart(2, "0")}`,
    )

    const planObj: ImportBatchPlan = {
      organizationId: org.id,
      label: `AzerSheker P&L ${args.year}${args.purge ? " (purge)" : ""}`,
      actorUserId: "system",
      sourceDocument: FILE,
      companyIds: targetEntities.map((e) => byCode.get(e.code)!.id),
      periodScope,
      rows: allRows,
      expectedSums,
      purgeArchivedFirst: args.purge,
    }

    console.log("\nRunning atomic P&L import batch ...")
    const t0 = Date.now()
    const result = await runImportBatch(prisma, planObj)
    const dt = Date.now() - t0

    console.log(`\nP&L batch ${result.batchId} completed in ${dt}ms`)
    console.log(`  archived: ${result.metrics.resetArchived}`)
    console.log(`  purged:   ${result.metrics.resetPurged}`)
    console.log(`  inserted: ${result.metrics.rowsInserted}`)
    console.log(`  recomputed IV: ${result.metrics.recomputedIvCount}`)
    console.log("")
    console.log(formatReconciliationSummary(result.reconciliation))

    // ── BS phase ─────────────────────────────────────────────────
    // Parse BS sheets for the same 4 entities, push into a separate
    // atomic batch on `balance_sheet_lines`. Reconciliation runs
    // independently of P&L because the schemas + recon keys differ.
    console.log("\n" + "=".repeat(72))
    console.log("Phase BS — parsing balance sheets")
    console.log("=".repeat(72))

    const bsRows: BsImportRow[] = []
    const bsExpectedSums = new Map<ReconciliationKey, number>()
    let bsParsedLineCount = 0

    for (const ent of targetEntities) {
      console.log(`\n→ Parsing ${ent.code} · sheet="${ent.bsSheet}"`)
      const bsResult = parseWorkbookBsSheet(wb, ent.bsSheet, XLSX, {
        preferYear: args.year,
      })
      if (bsResult.warnings.length > 0) {
        console.log(`  ⚠ ${bsResult.warnings.length} warning(s)`)
      }
      console.log(`  ${bsResult.lines.length} BS leaf lines parsed`)

      for (const line of bsResult.lines) {
        bsParsedLineCount += 1
        for (const [period, amount] of Object.entries(line.monthlyAmounts)) {
          if (amount === 0) continue
          if (!period.startsWith(String(args.year))) continue
          const month = Number(period.split("-")[1])
          if (!Number.isFinite(month)) continue
          const bsRow: BsImportRow = {
            planId: plan.id,
            accountCode: `${ent.code}-${line.code}`,
            accountName: line.label,
            lineType: line.lineType,
            subType: line.subType,
            year: args.year,
            month,
            amount,
            sourceCell: `Copy of Guvven Fin.xlsx#${ent.bsSheet}!${line.code}@${period}`,
          }
          bsRows.push(bsRow)
          const key = buildReconKey(plan.id, bsRow.accountCode, period)
          bsExpectedSums.set(key, (bsExpectedSums.get(key) ?? 0) + amount)
        }
      }
    }
    console.log(
      `\nBS parsing complete: ${bsParsedLineCount} leaf lines, ${bsRows.length} (account,month) rows ready, ${bsExpectedSums.size} unique recon keys`,
    )

    if (args.dryRun) {
      console.log("[dry-run] Skipping BS write.")
      return result.reconciliation.verdict === "green"
        ? 0
        : result.reconciliation.verdict === "yellow"
          ? 1
          : 2
    }

    const bsPlan: BsImportPlan = {
      organizationId: org.id,
      label: `AzerSheker BS ${args.year}${args.purge ? " (purge)" : ""}`,
      actorUserId: "system",
      sourceDocument: FILE,
      planIds: [plan.id],
      periodScope,
      rows: bsRows,
      expectedSums: bsExpectedSums,
      purgeArchivedFirst: args.purge,
    }

    console.log("\nRunning atomic BS import batch ...")
    const t1 = Date.now()
    const bsResult = await runBalanceSheetBatch(prisma, bsPlan)
    const dt1 = Date.now() - t1
    console.log(`\nBS batch ${bsResult.batchId} completed in ${dt1}ms`)
    console.log(`  archived: ${bsResult.metrics.resetArchived}`)
    console.log(`  purged:   ${bsResult.metrics.resetPurged}`)
    console.log(`  inserted: ${bsResult.metrics.rowsInserted}`)
    console.log("")
    console.log(formatReconciliationSummary(bsResult.reconciliation))

    // ── KPI phase ────────────────────────────────────────────────
    // Two adapters: Farming KPI (cross-entity, row-per-region) and
    // CPC Processing KPI (single-entity, row-per-metric). Both emit
    // `ParsedKpiFact[]` which we map to `OperationalFact` rows.
    console.log("\n" + "=".repeat(72))
    console.log("Phase KPI — parsing operational facts")
    console.log("=".repeat(72))

    const kpiRows: KpiImportRow[] = []
    const kpiExpectedSums = new Map<ReconciliationKey, number>()

    console.log(`\n→ Parsing Farming KPI (cross-entity)`)
    const farmingKpi = parseWorkbookFarmingKpiSheet(wb, "Farming KPI", XLSX, {
      preferYear: args.year,
    })
    console.log(
      `  ${farmingKpi.facts.length} facts parsed${farmingKpi.warnings.length > 0 ? ` · ${farmingKpi.warnings.length} warning(s)` : ""}`,
    )

    console.log(`\n→ Parsing CPC Processing KPI`)
    const cpcKpi = parseWorkbookProcessingKpiSheet(wb, "CPC KPI", XLSX, {
      preferYear: args.year,
    })
    console.log(
      `  ${cpcKpi.facts.length} facts parsed${cpcKpi.warnings.length > 0 ? ` · ${cpcKpi.warnings.length} warning(s)` : ""}`,
    )

    // Phase 7.M Step 7 (2026-05-19) — Sales adapters (3 sheets).
    // Farming Sales → AZSEKER-EDEN (Eden Agro, confirmed by Azik 2026-05-19)
    // Production Sales → AZSEKER-CPC (food_processing main facility)
    // ProMalt Sales → AZSEKER-PROMALT (Promalt MMC, separate legal entity
    //                                    that handles malt sales, confirmed
    //                                    by Azik 2026-05-19)
    //
    // AZSEKER-PROMALT bug-fix (Phase 7.M Tier 4): it's NOT in `targetEntities`
    // (no PL/BS/CF sheets in workbook), so `byCode` doesn't have it.
    // Look it up separately so ProMalt Sales can be routed correctly.
    const edenCompanyId = byCode.get("AZSEKER-EDEN")?.id
    const cpcCompanyId = byCode.get("AZSEKER-CPC")?.id
    const promaltCompany = await prisma.company.findFirst({
      where: { organizationId: org.id, code: "AZSEKER-PROMALT" },
      select: { id: true },
    })
    const promaltCompanyId = promaltCompany?.id
    let farmingSales: ReturnType<typeof parseFarmingSalesSheet> | null = null
    let productionSales: ReturnType<typeof parseProductionSalesSheet> | null = null
    let proMaltSales: ReturnType<typeof parseProMaltSalesSheet> | null = null
    if (edenCompanyId) {
      console.log(`\n→ Parsing Farming Sales (→ AZSEKER-EDEN)`)
      farmingSales = parseFarmingSalesSheet(
        wb,
        "Farming Budget sales plan",
        XLSX,
        { preferYear: args.year, companyId: edenCompanyId },
      )
      console.log(
        `  ${farmingSales.facts.length} sales facts parsed${farmingSales.warnings.length > 0 ? ` · ${farmingSales.warnings.length} warning(s)` : ""}`,
      )
    }
    if (cpcCompanyId) {
      console.log(`\n→ Parsing Production Sales (→ AZSEKER-CPC)`)
      productionSales = parseProductionSalesSheet(
        wb,
        "Production Budget sales plan",
        XLSX,
        { preferYear: args.year, companyId: cpcCompanyId },
      )
      console.log(
        `  ${productionSales.facts.length} sales facts parsed${productionSales.warnings.length > 0 ? ` · ${productionSales.warnings.length} warning(s)` : ""}`,
      )
    }
    if (promaltCompanyId) {
      console.log(`\n→ Parsing ProMalt Sales (→ AZSEKER-PROMALT)`)
      proMaltSales = parseProMaltSalesSheet(wb, "Satış ProMalt", XLSX, {
        preferYear: args.year,
        companyId: promaltCompanyId,
      })
      console.log(
        `  ${proMaltSales.facts.length} sales facts parsed${proMaltSales.warnings.length > 0 ? ` · ${proMaltSales.warnings.length} warning(s)` : ""}`,
      )
    } else {
      console.warn(
        `\n⚠ AZSEKER-PROMALT entity not found — skipping ProMalt Sales. Run scripts/sync-azseker-entities.ts to create it.`,
      )
    }

    // Aggregate both adapter outputs. Look up company by code for
    // each fact since adapter emits `companyCode`, not id.
    const allCompaniesById = new Map<string, string>() // code → id
    const allEntityCompanies = await prisma.company.findMany({
      where: {
        organizationId: org.id,
        code: { startsWith: "AZSEKER" },
      },
      select: { id: true, code: true },
    })
    for (const c of allEntityCompanies) allCompaniesById.set(c.code, c.id)

    const allFacts = [...farmingKpi.facts, ...cpcKpi.facts]
    const kpiDateScope = new Set<string>()
    let kpiSkippedNoEntity = 0
    for (const fact of allFacts) {
      const companyId = allCompaniesById.get(fact.companyCode)
      if (!companyId) {
        kpiSkippedNoEntity += 1
        continue
      }
      if (!fact.date.startsWith(String(args.year))) continue
      kpiDateScope.add(fact.date)
      const row: KpiImportRow = {
        companyId,
        metric: fact.metric,
        date: fact.date,
        value: fact.value,
        unit: fact.unit || null,
        source: "xlsx_import",
      }
      kpiRows.push(row)
      const key = buildReconKey(companyId, fact.metric, fact.date)
      kpiExpectedSums.set(key, (kpiExpectedSums.get(key) ?? 0) + fact.value)
    }
    // Merge each sales adapter's facts + expectedSums into the KPI
    // batch (single transaction). Each adapter pre-keyed its
    // expectedSums by the right companyId — we just need to forward
    // the rows with their respective company ids.
    const mergeSales = (
      sales: ReturnType<typeof parseFarmingSalesSheet> | null,
      companyId: string | undefined,
      label: string,
    ) => {
      if (!sales || !companyId) return
      for (const fact of sales.facts) {
        kpiRows.push({
          companyId,
          metric: fact.metric,
          date: fact.date,
          value: fact.value,
          unit: fact.unit,
          source: "xlsx_import",
        })
      }
      for (const [k, v] of sales.expectedSums) {
        kpiExpectedSums.set(k, (kpiExpectedSums.get(k) ?? 0) + v)
      }
      console.log(
        `  + ${sales.facts.length} ${label} facts (→ ${sales.expectedSums.size} recon keys)`,
      )
    }
    mergeSales(farmingSales, edenCompanyId, "farming-sales")
    mergeSales(productionSales, cpcCompanyId, "production-sales")
    mergeSales(proMaltSales, promaltCompanyId, "promalt-sales")
    console.log(
      `\nKPI parsing complete: ${kpiRows.length} rows ready, ${kpiExpectedSums.size} unique recon keys, ${kpiSkippedNoEntity} skipped (unknown entity code)`,
    )

    if (args.dryRun) {
      return result.reconciliation.verdict === "green" &&
        bsResult.reconciliation.verdict === "green"
        ? 0
        : 1
    }

    const kpiPlan: KpiImportPlan = {
      organizationId: org.id,
      label: `AzerSheker KPI ${args.year}`,
      actorUserId: "system",
      sourceDocument: FILE,
      companyIds: Array.from(allCompaniesById.values()),
      dateScope: [String(args.year)],
      rows: kpiRows,
      expectedSums: kpiExpectedSums,
    }

    console.log("\nRunning atomic KPI import batch ...")
    const t2 = Date.now()
    const kpiResult = await runKpiBatch(prisma, kpiPlan)
    const dt2 = Date.now() - t2
    console.log(`\nKPI batch ${kpiResult.batchId} completed in ${dt2}ms`)
    console.log(`  deleted (prior): ${kpiResult.metrics.resetDeleted}`)
    console.log(`  inserted:        ${kpiResult.metrics.rowsInserted}`)
    console.log("")
    console.log(formatReconciliationSummary(kpiResult.reconciliation))

    // ── CF phase ─────────────────────────────────────────────────
    // 4 entities × CF sheets → cash_flow_entries. The CF table is
    // org-scoped (no companyId column); we encode the entity in
    // `sourceId` so drill-down can disambiguate.
    console.log("\n" + "=".repeat(72))
    console.log("Phase CF — parsing cash flow statements")
    console.log("=".repeat(72))

    const cfRows: CfImportRow[] = []
    const cfExpectedSums = new Map<ReconciliationKey, number>()
    let cfParsedEntries = 0

    for (const ent of targetEntities) {
      console.log(`\n→ Parsing ${ent.code} · sheet="${ent.cfSheet}"`)
      const cfRes = parsePlfCfSheet(wb, ent.cfSheet, XLSX, {
        preferYear: args.year,
      })
      if (cfRes.warnings.length > 0) {
        console.log(`  ⚠ ${cfRes.warnings.length} warning(s)`)
      }
      console.log(`  ${cfRes.entries.length} CF entries parsed`)

      for (const entry of cfRes.entries) {
        cfParsedEntries += 1
        for (let m = 0; m < 12; m++) {
          const amount = entry.perMonth[m]
          if (amount === 0) continue
          const period = `${args.year}-${String(m + 1).padStart(2, "0")}`
          const sourceId = `${ent.code}::${entry.code}`
          const row: CfImportRow = {
            entityCode: ent.code,
            cfCode: entry.code,
            category: `${ent.code}-${entry.code}`,
            activityType: entry.activityType,
            entryType: entry.entryType,
            year: args.year,
            month: m + 1,
            amount,
            currencyCode: "AZN",
            description: entry.label,
            source: CF_SOURCE_TAG,
            sourceId,
          }
          cfRows.push(row)
          const key = buildReconKey(CF_SOURCE_TAG, sourceId, period)
          cfExpectedSums.set(key, (cfExpectedSums.get(key) ?? 0) + amount)
        }
      }
    }
    console.log(
      `\nCF parsing complete: ${cfParsedEntries} entries, ${cfRows.length} (entity,code,month) rows ready, ${cfExpectedSums.size} unique recon keys`,
    )

    const cfPlan: CfImportPlan = {
      organizationId: org.id,
      label: `AzerSheker CF ${args.year}${args.purge ? " (purge)" : ""}`,
      actorUserId: "system",
      sourceDocument: FILE,
      sourceTag: CF_SOURCE_TAG,
      periodScope,
      rows: cfRows,
      expectedSums: cfExpectedSums,
      purgeArchivedFirst: args.purge,
    }

    console.log("\nRunning atomic CF import batch ...")
    const t3 = Date.now()
    const cfResult = await runCashFlowBatch(prisma, cfPlan)
    const dt3 = Date.now() - t3
    console.log(`\nCF batch ${cfResult.batchId} completed in ${dt3}ms`)
    console.log(`  archived: ${cfResult.metrics.resetArchived}`)
    console.log(`  purged:   ${cfResult.metrics.resetPurged}`)
    console.log(`  inserted: ${cfResult.metrics.rowsInserted}`)
    console.log("")
    console.log(formatReconciliationSummary(cfResult.reconciliation))

    // ── Recompute phase (Phase 7.M Step 6, combined 2026-05-19) ──
    // P&L + KPI writes both invalidate IndicatorValue rows for the
    // touched entities. Triggering recompute here so the caller
    // doesn't have to remember to run scripts/recompute-azseker-
    // workbook.ts separately. BS + CF writes don't drive any IV
    // formulas in v1, but recompute is cheap and safer to run anyway.
    console.log("\n" + "=".repeat(72))
    console.log("Phase RECOMPUTE — refreshing IndicatorValue rows")
    console.log("=".repeat(72))
    const t4 = Date.now()
    const recomputeAffected = targetEntities.map((e) => ({
      companyId: byCode.get(e.code)!.id,
      year: args.year,
    }))
    const recomputeResult = await runRecomputeForCompanies(
      prisma,
      org.id,
      recomputeAffected,
      {
        start: (msg: string) => console.log("[recompute]", msg),
        pairError: (label: string, err: unknown) =>
          console.warn("[recompute] FAIL", label, err),
      },
    )
    const dt4 = Date.now() - t4
    console.log(`\nRecompute complete in ${dt4}ms:`)
    console.log(`  targets: ${recomputeResult.targets}`)
    console.log(`  ok:      ${recomputeResult.ok}`)
    console.log(`  unknown: ${recomputeResult.unknown}`)
    console.log(`  failed:  ${recomputeResult.failed}`)

    // Overall verdict — worst-of P&L + BS + KPI + CF.
    const verdicts = [
      result.reconciliation.verdict,
      bsResult.reconciliation.verdict,
      kpiResult.reconciliation.verdict,
      cfResult.reconciliation.verdict,
    ]
    const rank = { green: 0, yellow: 1, red: 2 } as const
    const worst = verdicts.reduce(
      (acc, v) => (rank[v] > rank[acc] ? v : acc),
      "green" as "green" | "yellow" | "red",
    )
    console.log("\n" + "=".repeat(72))
    console.log(
      `OVERALL verdict (worst-of P&L + BS + KPI + CF): ${worst.toUpperCase()}`,
    )
    if (recomputeResult.failed > 0) {
      console.log(
        `⚠ Recompute had ${recomputeResult.failed} failure(s) — IV rows may be stale; see scripts/recompute-azseker-workbook.ts.`,
      )
    }
    console.log("=".repeat(72))

    return worst === "green" ? 0 : worst === "yellow" ? 1 : 2
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("[import-workbook-batch] fatal:", e)
    process.exit(3)
  })
