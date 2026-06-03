/**
 * One-time cleanup (2026-06-03, user «удали»): remove the synthetic "2099"
 * period from the AzerSheker org. 2099 is not a real fiscal year — 31
 * IndicatorValue rows (MALT + the holding rollup) carry hand-rounded demo
 * numbers (revenue 1.2M / COGS 480K / EBITDA 720K / opex 0 / exactly 60%) with
 * NO backing data: verified there is no BudgetPlan, BudgetLine, OperationalFact,
 * IndicatorDisclosure, BudgetForecastEntry, or forwardForecast settings entry
 * for 2099. A leftover test/demo insert. The "only real numbers" rule on this
 * financial app means it must go.
 *
 * Scope: IndicatorValue WHERE organizationId = <AzerSheker org> AND period =
 * '2099'. Also reports (does NOT auto-delete) any 2099 rows found in the other
 * period-keyed tables, so a future surprise is visible rather than silent.
 * Idempotent + safe to re-run (a second run finds 0). Nothing depends on these
 * derived rows, and no recompute recreates them (there is no 2099 source data).
 *
 *   DRY=1 npx tsx scripts/purge-2099-synthetic.ts   # report only, NO deletes
 *         npx tsx scripts/purge-2099-synthetic.ts   # delete + verify
 *   DATABASE_URL="<prod-url>" npx tsx scripts/purge-2099-synthetic.ts   # prod
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const DRY = process.env.DRY === "1"
const PERIOD = "2099"

async function main() {
  console.log(`${DRY ? "DRY (no deletes)" : "PURGE"} — synthetic period "${PERIOD}"\n`)

  // Resolve the AzerSheker org from its companies (defense-in-depth scope).
  const anyCo = await prisma.company.findFirst({
    where: { code: { startsWith: "AZSEKER" } },
    select: { organizationId: true },
  })
  if (!anyCo) throw new Error("no AZSEKER org found")
  const organizationId = anyCo.organizationId

  // What we're about to remove (audit record).
  const doomed = await prisma.indicatorValue.findMany({
    where: { organizationId, period: PERIOD },
    select: { value: true, company: { select: { code: true } }, indicator: { select: { code: true } } },
    orderBy: [{ company: { code: "asc" } }, { indicator: { code: "asc" } }],
  })
  console.log(`IndicatorValue rows @${PERIOD}: ${doomed.length}`)
  for (const d of doomed) console.log(`  ${d.company?.code ?? "—"} / ${d.indicator.code} = ${d.value}`)

  // Completeness scan — other period/year-keyed tables. Report only.
  const otherChecks: Array<[string, () => Promise<number>]> = [
    ["BudgetPlan(year=2099)", () => prisma.budgetPlan.count({ where: { year: 2099 } })],
    ["BalanceSheetLine(year=2099)", () => prisma.balanceSheetLine.count({ where: { year: 2099 } })],
    ["CashFlowEntry(year=2099)", () => prisma.cashFlowEntry.count({ where: { year: 2099 } })],
    [
      "OperationalFact(date in 2099)",
      () =>
        prisma.operationalFact.count({
          where: { date: { gte: new Date(Date.UTC(2099, 0, 1)), lt: new Date(Date.UTC(2100, 0, 1)) } },
        }),
    ],
    ["IndicatorDisclosure(period=2099)", () => prisma.indicatorDisclosure.count({ where: { period: PERIOD } })],
  ]
  console.log("\nOther 2099 artifacts (report only):")
  for (const [label, fn] of otherChecks) {
    const n = await fn().catch(() => -1)
    console.log(`  ${label}: ${n < 0 ? "n/a" : n}`)
  }

  if (DRY) {
    console.log(`\nDRY done — re-run without DRY=1 to delete the ${doomed.length} IndicatorValue rows.`)
    await prisma.$disconnect()
    return
  }

  const res = await prisma.indicatorValue.deleteMany({ where: { organizationId, period: PERIOD } })
  console.log(`\nDeleted ${res.count} IndicatorValue rows @${PERIOD}.`)

  // Verify.
  const remaining = await prisma.indicatorValue.count({ where: { period: PERIOD } })
  const futurePeriods = (
    await prisma.indicatorValue.findMany({ select: { period: true }, distinct: ["period"] })
  )
    .map((r) => r.period)
    .filter((p) => /^\d{4}$/.test(p) && Number(p) > 2030)
  console.log(`Verify — IndicatorValue @${PERIOD} remaining: ${remaining} (expect 0)`)
  console.log(`Verify — any future annual period (>2030) left: ${JSON.stringify(futurePeriods)} (expect [])`)
  await prisma.$disconnect()
  console.log("\nDONE.")
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
