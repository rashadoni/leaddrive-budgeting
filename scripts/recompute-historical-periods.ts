#!/usr/bin/env tsx
/**
 * Phase 7.N follow-up — recompute IndicatorValue rows for historical periods
 * after import-historical-actuals.mjs populated BudgetLine data for 2020-2025.
 *
 * Without this step the Risk Terminal HeatMap shows no sparkline trends for
 * historical years — every cell shows only the 2026 data point because
 * IndicatorValue rows exist only for 2026.
 *
 * Historical data coverage (from import-historical-actuals.mjs):
 *   AZSEKER-CPC  : PLF/CF 2022-2025, BS 2020-2025   → years 2020-2025
 *   AZSEKER-AZSF : PLF/CF 2023-2025, BS 2022-2025   → years 2022-2025
 *   AZSEKER-EDEN : PLF/CF 2023-2025, BS 2024-2025   → years 2023-2025
 *   AZSEKER-MALT : PLF/CF/BS 2025                   → year  2025
 *
 * The recompute is idempotent — running it again produces identical rows.
 * Years with no BudgetLine data will return status=unknown (correct, not an error).
 *
 * Run:
 *   npx tsx scripts/recompute-historical-periods.ts
 *   npx tsx scripts/recompute-historical-periods.ts --dry-run   # print plan only
 *
 * After recompute completes, run sparkline refresh to populate trend arrays:
 *   npx tsx scripts/compute-sparklines.ts
 */

import { PrismaClient } from "@prisma/client"
import { runRecomputeForCompanies } from "../src/lib/risk/recompute-trigger"

// Per-entity years that received BudgetLine data in the historical import.
// The recompute engine returns status=unknown for year×indicators that have
// no underlying data — that is fine and expected for months with 0 rows.
const HISTORICAL_SCOPE: Record<string, number[]> = {
  "AZSEKER-CPC":  [2020, 2021, 2022, 2023, 2024, 2025],
  "AZSEKER-AZSF": [2022, 2023, 2024, 2025],
  "AZSEKER-EDEN": [2023, 2024, 2025],
  "AZSEKER-MALT": [2025],
}

const isDryRun = process.argv.includes("--dry-run")

async function main(): Promise<number> {
  const prisma = new PrismaClient()

  try {
    // Resolve org — same anchor used in all AZSEKER scripts
    const anchor = await prisma.company.findFirst({
      where: { code: { in: ["AZSEKER-CPC", "AZSEKER-AZSF"] } },
      select: { organizationId: true },
    })
    if (!anchor) {
      console.error("[historical-recompute] No AZSEKER company found — wrong DB?")
      return 1
    }
    const orgId = anchor.organizationId

    // Resolve entity codes → ids
    const entityCodes = Object.keys(HISTORICAL_SCOPE)
    const companies = await prisma.company.findMany({
      where: { organizationId: orgId, code: { in: entityCodes } },
      select: { id: true, code: true },
    })
    const codeToId = new Map(companies.map((c) => [c.code, c.id]))

    // Build (companyId × year) pairs
    const affected: Array<{ companyId: string; year: number }> = []
    for (const [code, years] of Object.entries(HISTORICAL_SCOPE)) {
      const id = codeToId.get(code)
      if (!id) {
        console.warn(`[historical-recompute] ${code}: not found in DB, skipping`)
        continue
      }
      for (const year of years) {
        affected.push({ companyId: id, year })
      }
    }

    console.log(`[historical-recompute] org=${orgId}`)
    console.log(`[historical-recompute] resolved ${companies.length}/${entityCodes.length} entities`)
    console.log(`[historical-recompute] ${affected.length} (company × year) pairs to recompute`)
    for (const { companyId, year } of affected) {
      const code = companies.find((c) => c.id === companyId)?.code ?? companyId
      console.log(`  ${code.padEnd(20)} year=${year}`)
    }

    if (isDryRun) {
      console.log("\n[historical-recompute] --dry-run: stopping before recompute")
      return 0
    }

    console.log("\n[historical-recompute] Starting recompute...")
    const t0 = Date.now()

    const result = await runRecomputeForCompanies(
      prisma,
      orgId,
      affected,
      {
        start:     (msg: string) => console.log(`  ${msg}`),
        done:      (msg: string) => console.log(`  ${msg}`),
        pairError: (label: string, err: unknown) =>
          console.error(`  ✗ ${label}: ${err instanceof Error ? err.message : String(err)}`),
      },
    )

    const ms = Date.now() - t0
    console.log(`\n[historical-recompute] Done in ${(ms / 1000).toFixed(1)}s:`)
    console.log(`  targets : ${result.targets ?? affected.length}`)
    console.log(`  ok      : ${result.ok}`)
    console.log(`  unknown : ${result.unknown}`)
    console.log(`  failed  : ${result.failed}`)

    if (result.failed > 0) {
      console.warn("\n[historical-recompute] Some pairs failed — check pairError lines above")
    }

    console.log("\n[historical-recompute] NEXT STEP:")
    console.log("  Run sparkline refresh to populate 12-slot trend arrays:")
    console.log("  npx tsx scripts/compute-sparklines.ts")

    return result.failed > 0 ? 1 : 0
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("[historical-recompute] FATAL:", e)
    process.exit(2)
  })
