/**
 * Phase 7.H Feature 5 follow-up — recompute IndicatorValues for FO Holding
 * 2026 after the canonical re-import (`import-azmade-budgets.ts`) replaced
 * 7,886 detailed Input PL rows with 568 leaves × 12 months from SOPL P-F /
 * SOPL / P&L canonical sheets.
 *
 * Scope:
 *   - All 8 AZMADE operational entities + 4 AZSEKER operational entities
 *   - Year 2026
 *   - Triggers `runRecomputeForCompanies` which writes IndicatorValue rows
 *     for every (company × indicator × period) pair that the new BudgetLine
 *     data unlocks.
 *
 * Run: npx tsx scripts/recompute-fo-2026.ts
 */
import { PrismaClient } from "@prisma/client"
import { runRecomputeForCompanies } from "../src/lib/risk/recompute-trigger"

const prisma = new PrismaClient()
const YEAR = 2026

const TARGET_CODES = [
  // AZMADE 8
  "LLS-MAIN",
  "SPARK-MAIN",
  "ZTP-MAIN",
  "ATL-DBZ",
  "ATL-PMZ",
  "ATL-TAZ",
  "ATL-MRKZ",
  "AAC-MAIN",
  // AZSEKER 5 (HORIZON gets recomputed too — indicators will return
  // unknown until its first xlsx, which is the right state).
  "AZSEKER-EDEN",
  "AZSEKER-AZSF",
  "AZSEKER-HORIZON",
  "AZSEKER-FARM",
  "AZSEKER-CPC",
]

async function main() {
  // Resolve org via any one company (the AZMADE org is shared by all FO entities).
  const sample = await prisma.company.findFirst({
    where: { code: "AAC-MAIN" },
    select: { organizationId: true },
  })
  if (!sample) throw new Error("AAC-MAIN not found — wrong env?")
  const orgId = sample.organizationId

  const companies = await prisma.company.findMany({
    where: { organizationId: orgId, code: { in: TARGET_CODES } },
    select: { id: true, code: true },
  })
  console.log(`Resolved ${companies.length}/${TARGET_CODES.length} target companies in org ${orgId}`)

  if (companies.length === 0) {
    console.error("No companies resolved — aborting.")
    return
  }

  const affected = companies.map((c) => ({ companyId: c.id, year: YEAR }))

  console.log(`\nRunning recompute for ${affected.length} (company × year=${YEAR}) pairs...`)
  const t0 = Date.now()
  const result = await runRecomputeForCompanies(prisma, orgId, affected, {
    start: (msg) => console.log(`  ${msg}`),
    pairError: (label, err) => console.error(`  ✗ ${label}: ${err instanceof Error ? err.message : String(err)}`),
    done: (msg) => console.log(`  ${msg}`),
  })
  const ms = Date.now() - t0
  console.log(`\nRecompute finished in ${(ms / 1000).toFixed(1)}s:`)
  console.log(`  ok      = ${result.ok}`)
  console.log(`  unknown = ${result.unknown}`)
  console.log(`  failed  = ${result.failed}`)
  console.log(`  targets = ${result.targets}`)
  const ae = result.alertEvents
  if (ae.totalCreated > 0 || ae.failed > 0) {
    console.log(`  alertEvents: persisted=${ae.totalCreated} (deleted=${ae.totalDeleted}, failed=${ae.failed}, periods=${ae.periodsPersisted})`)
  }

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
