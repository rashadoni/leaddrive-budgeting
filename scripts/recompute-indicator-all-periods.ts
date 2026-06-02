/**
 * Targeted maintenance recompute — refresh EVERY existing IndicatorValue for a
 * single indicator code, across all the (company × period) pairs it currently
 * has rows for (annual + quarterly + monthly + historical years).
 *
 * Why this exists: `runRecomputeForCompanies` writes only the ANNUAL period,
 * and the periodic backfill writes ALL indicators. When ONE indicator's formula
 * changes (e.g. AGRO_COMMODITY_VOL: commodity_price_stdev → sugar_price_stdev_12m),
 * its non-annual + historical IVs keep a STALE error referencing the defunct
 * variable, inflating the indicator-health gap count even though the current
 * period is green. This script re-evaluates only that indicator's existing IVs
 * with the live formula — minimal blast radius, no other indicator touched.
 *
 * Run:
 *   npx tsx scripts/recompute-indicator-all-periods.ts --code=AGRO_COMMODITY_VOL
 *   npx tsx scripts/recompute-indicator-all-periods.ts --code=AGRO_COMMODITY_VOL --dry-run
 */
import { PrismaClient } from "@prisma/client"
import { recomputeIndicator, createPrismaDataSource } from "../src/lib/risk/recompute"

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=")
      return [k, v ?? "true"]
    }),
)

const code = args.code
const dryRun = args["dry-run"] === "true"

async function main() {
  if (!code) throw new Error("Pass --code=<INDICATOR_CODE>")
  const prisma = new PrismaClient()

  // Every existing IV for this indicator — the exact set we refresh.
  const ivs = await prisma.indicatorValue.findMany({
    where: { indicator: { code } },
    select: {
      companyId: true,
      organizationId: true,
      indicatorId: true,
      period: true,
      status: true,
      inputs: true,
    },
  })
  if (ivs.length === 0) throw new Error(`No IndicatorValue rows for code ${code}`)

  // BEFORE snapshot
  const staleVar = (iv: (typeof ivs)[number]): string | null => {
    const reason =
      (iv.inputs as { error?: { reason?: string } } | null)?.error?.reason ?? ""
    const m = /undefined variable: (\w+)/.exec(reason)
    return m ? m[1] : null
  }
  const before = { green: 0, amber: 0, red: 0, unknown: 0 }
  const beforeVars = new Map<string, number>()
  for (const iv of ivs) {
    before[iv.status as keyof typeof before] =
      (before[iv.status as keyof typeof before] ?? 0) + 1
    const v = staleVar(iv)
    if (v) beforeVars.set(v, (beforeVars.get(v) ?? 0) + 1)
  }

  const indicatorIds = [...new Set(ivs.map((iv) => iv.indicatorId))]
  const orgIds = [...new Set(ivs.map((iv) => iv.organizationId))]
  const companyIds = [...new Set(ivs.map((iv) => iv.companyId))]

  console.log(`Indicator: ${code}`)
  console.log(`  IVs: ${ivs.length} across ${companyIds.length} companies, ${new Set(ivs.map((i) => i.period)).size} periods`)
  console.log(`  definitions: ${indicatorIds.length}, orgs: ${orgIds.length}`)
  console.log(`  BEFORE status: ${JSON.stringify(before)}`)
  console.log(`  BEFORE missing-vars: ${JSON.stringify(Object.fromEntries(beforeVars))}`)

  if (dryRun) {
    console.log(`\n[dry-run] would recompute ${ivs.length} IVs. No writes.`)
    await prisma.$disconnect()
    return
  }

  const defs = await prisma.indicatorDefinition.findMany({
    where: { id: { in: indicatorIds } },
    select: {
      id: true, code: true, formula: true, sparklineFormula: true,
      thresholds: true, requiredInputs: true, unit: true, aggregation: true,
    },
  })
  const defById = new Map(defs.map((d) => [d.id, d]))

  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, code: true, baseCurrencyCode: true, industry: true },
  })
  const coById = new Map(companies.map((c) => [c.id, c]))

  const ds = createPrismaDataSource(prisma)
  let ok = 0, unknown = 0, failed = 0
  for (const iv of ivs) {
    const def = defById.get(iv.indicatorId)
    const co = coById.get(iv.companyId)
    if (!def || !co) { failed++; continue }
    try {
      const result = await recomputeIndicator(ds, {
        organizationId: iv.organizationId,
        companyId: iv.companyId,
        definition: {
          id: def.id,
          code: def.code,
          formula: def.formula,
          sparklineFormula: def.sparklineFormula,
          thresholds: def.thresholds as never,
          requiredInputs: def.requiredInputs,
          unit: def.unit,
          aggregation: def.aggregation,
        },
        period: iv.period,
        baseCurrency: co.baseCurrencyCode ?? undefined,
        industry: co.industry ?? undefined,
      })
      if (result.status === "unknown") unknown++
      else ok++
    } catch (err) {
      failed++
      if (failed <= 5) console.log(`  ⚠ ${co.code}@${iv.period}: ${(err as Error).message}`)
    }
  }
  console.log(`\nRecomputed: ok=${ok}, unknown=${unknown}, failed=${failed}`)

  // AFTER snapshot — re-read
  const after = await prisma.indicatorValue.findMany({
    where: { indicator: { code } },
    select: { status: true, inputs: true },
  })
  const a = { green: 0, amber: 0, red: 0, unknown: 0 }
  const afterVars = new Map<string, number>()
  for (const iv of after) {
    a[iv.status as keyof typeof a] = (a[iv.status as keyof typeof a] ?? 0) + 1
    const reason =
      (iv.inputs as { error?: { reason?: string } } | null)?.error?.reason ?? ""
    const m = /undefined variable: (\w+)/.exec(reason)
    if (m) afterVars.set(m[1], (afterVars.get(m[1]) ?? 0) + 1)
  }
  console.log(`  AFTER status: ${JSON.stringify(a)}`)
  console.log(`  AFTER missing-vars: ${JSON.stringify(Object.fromEntries(afterVars))}`)

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
