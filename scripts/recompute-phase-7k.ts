/**
 * Run a full recompute across every operational company in the org
 * so the new Phase 7.K live data points propagate into IndicatorValue
 * rows. Use after fetching live external data.
 *
 *   DATABASE_URL=... npx tsx scripts/recompute-phase-7k.ts
 */
import { PrismaClient } from "@prisma/client"
import { runRecomputeForCompanies } from "../src/lib/risk/recompute-trigger"

const prisma = new PrismaClient()
const PERIOD_YEAR = 2026

async function main() {
  const org = await prisma.organization.findFirst({
    select: { id: true, name: true },
  })
  if (!org) throw new Error("No organization")
  console.log(`Org: ${org.name} (${org.id})`)

  const ops = await prisma.company.findMany({
    where: {
      organizationId: org.id,
      level: 2,
      industry: { not: null },
    },
    select: { id: true, code: true, industry: true, name: true },
  })
  console.log(`Operational companies (level=2 with industry): ${ops.length}`)
  for (const c of ops) {
    console.log(`  ${c.code.padEnd(20)} industry=${c.industry}`)
  }
  console.log()

  const affected = ops.map((c) => ({
    companyId: c.id,
    year: PERIOD_YEAR,
  }))

  console.log(`Triggering recompute for ${affected.length} companies × period=${PERIOD_YEAR}...`)
  const startedAt = Date.now()
  const result = await runRecomputeForCompanies(
    prisma,
    org.id,
    affected,
    {
      start: (msg: string) => console.log(`  ${msg}`),
      done: (msg: string) => console.log(`  ${msg}`),
      pairError: (label: string, err: unknown) =>
        console.error(
          `  ERR ${label}: ${err instanceof Error ? err.message : String(err)}`,
        ),
    },
    {},
  )
  const ms = Date.now() - startedAt
  console.log(`\nDone in ${ms}ms`)
  console.log(`  ok:      ${result.ok}`)
  console.log(`  unknown: ${result.unknown}`)
  console.log(`  failed:  ${result.failed}`)
  console.log(`  targets: ${result.targets}`)

  // After recompute, check Phase 7.K indicator IV state
  const phase7kCodes = [
    "HOSP_TOURISM_ARRIVALS_SIGNAL",
    "PHARM_FX_USD_PRESSURE",
    "RE_HOUSING_CPI_PRESSURE",
    "IND_COPPER_PRICE_SIGNAL",
    "IND_NATGAS_PRICE_SIGNAL",
    "CONSTR_STEEL_PRICE_SIGNAL",
    "CONSTR_LUMBER_PRICE_SIGNAL",
    "LOG_DIESEL_PRICE_SIGNAL",
    "LOG_BDI_FREIGHT_SIGNAL",
    "LOG_BRENT_OIL_SIGNAL",
    "POULT_BROILER_PRICE_SIGNAL",
    "POULT_FEED_CORN_PRESSURE",
    "POULT_EGG_PRICE_SIGNAL",
    "FP_FAO_FOOD_INDEX_SIGNAL",
    "FP_WHEAT_PRICE_SIGNAL",
    "FP_GRAIN_COST_PRESSURE_BLEND",
    "BEV_FAO_SUGAR_INDEX_SIGNAL",
    "RET_AZ_FOOD_CPI_PRESSURE",
    "RET_TREND_FOOD_SIGNAL",
    "EDU_POPULATION_0_14_SIGNAL",
    "ENT_TRAVEL_DEMAND_SIGNAL",
    "SERV_AZ_TRADE_BALANCE_SIGNAL",
    "AGRO_SALYAN_RAINFALL_14D_FCST",
  ]
  console.log("\nPhase 7.K indicator status per company:")
  console.log("─".repeat(110))
  for (const code of phase7kCodes) {
    const def = await prisma.indicatorDefinition.findFirst({
      where: {
        code,
        OR: [{ organizationId: org.id }, { organizationId: null }],
      },
      select: { id: true, industries: true },
    })
    if (!def) continue
    const ivs = await prisma.indicatorValue.findMany({
      where: {
        organizationId: org.id,
        indicatorId: def.id,
        period: String(PERIOD_YEAR),
      },
      select: {
        companyId: true,
        value: true,
        status: true,
      },
    })
    const sectorList = def.industries.join("/")
    const statusBreakdown: Record<string, number> = {}
    for (const iv of ivs) {
      statusBreakdown[iv.status] = (statusBreakdown[iv.status] ?? 0) + 1
    }
    const summary = Object.entries(statusBreakdown)
      .map(([s, n]) => `${s}=${n}`)
      .join(" ")
    console.log(
      `  ${code.padEnd(34)} ${sectorList.padEnd(25)} ${ivs.length} IVs · ${summary}`,
    )
  }
}

main()
  .catch((e) => {
    console.error("Script error:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
