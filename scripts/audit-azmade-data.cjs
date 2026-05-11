/**
 * READ-ONLY audit — counts AZMADE data per table, distinguishes real
 * (xlsx-imported) vs fake (seed-azmade-*). Plain CommonJS so `node`
 * runs it without tsx. Usage: `node scripts/audit-azmade-data.cjs`
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const FAKE_AZ_PREFIX = "AZ-"

async function main() {
  const org = await prisma.organization.findFirst({
    where: { slug: "azmade" },
    select: { id: true, name: true },
  })
  if (!org) {
    console.log("AZMADE org not found.")
    return
  }
  console.log(`\n=== AZMADE org: ${org.name} (${org.id}) ===\n`)

  const companies = await prisma.company.findMany({
    where: { organizationId: org.id },
    select: { id: true, code: true, name: true, level: true },
    orderBy: { code: "asc" },
  })
  const realCo = companies.filter((c) => !c.code.startsWith(FAKE_AZ_PREFIX))
  const fakeCo = companies.filter((c) => c.code.startsWith(FAKE_AZ_PREFIX))
  console.log(`Companies total: ${companies.length}`)
  console.log(`  REAL (${realCo.length}): ${realCo.map((c) => c.code).join(", ")}`)
  console.log(`  FAKE AZ-* (${fakeCo.length}): ${fakeCo.map((c) => c.code).join(", ")}`)

  const plans = await prisma.budgetPlan.findMany({
    where: { organizationId: org.id, deletedAt: null },
    select: { id: true, name: true, year: true },
    orderBy: { year: "asc" },
  })
  console.log(`\nBudget plans (${plans.length}):`)
  for (const p of plans) console.log(`  - ${p.name} (${p.year}) [${p.id}]`)

  for (const p of plans) {
    const lineCount = await prisma.budgetLine.count({ where: { planId: p.id } })
    const linesByCompany = await prisma.budgetLine.groupBy({
      by: ["companyId"],
      where: { planId: p.id },
      _count: { _all: true },
    })
    console.log(`\n  BudgetLines in "${p.name}": ${lineCount}`)
    for (const grp of linesByCompany) {
      const co = companies.find((c) => c.id === grp.companyId)
      console.log(`    ${co ? co.code : "(no company)"} → ${grp._count._all} lines`)
    }
  }

  const cfBySource = await prisma.cashFlowEntry.groupBy({
    by: ["source"],
    where: { organizationId: org.id },
    _count: { _all: true },
    _sum: { amount: true },
  })
  console.log(`\nCashFlowEntries by source:`)
  for (const grp of cfBySource) {
    const tag = grp.source === "plan" ? "FAKE (seed-azmade-rich)" : "real or generated"
    console.log(`  ${grp.source}: ${grp._count._all} rows, sum=${grp._sum.amount ? grp._sum.amount.toFixed(0) : 0} [${tag}]`)
  }

  const tables = [
    ["sales_budget_lines", () => prisma.salesBudgetLine.count({ where: { organizationId: org.id } })],
    ["cogs_budget_lines", () => prisma.cOGSBudgetLine.count({ where: { organizationId: org.id } })],
    ["balance_sheet_lines", () => prisma.balanceSheetLine.count({ where: { organizationId: org.id } })],
    ["budget_assumptions", () => prisma.budgetAssumption.count({ where: { organizationId: org.id } })],
    ["sales_forecasts", () => prisma.salesForecast.count({ where: { organizationId: org.id } })],
    ["expense_forecasts", () => prisma.expenseForecast.count({ where: { organizationId: org.id } })],
    ["rolling_forecast_months", () => prisma.rollingForecastMonth.count({ where: { organizationId: org.id } })],
    ["budget_forecast_entries", () => prisma.budgetForecastEntry.count({ where: { organizationId: org.id } })],
    ["budget_actuals", () => prisma.budgetActual.count({ where: { organizationId: org.id } })],
    ["budget_departments", () => prisma.budgetDepartment.count({ where: { organizationId: org.id } })],
    ["budget_cost_types", () => prisma.budgetCostType.count({ where: { organizationId: org.id } })],
    ["product_lines", () => prisma.productLine.count({ where: { organizationId: org.id } })],
    ["chart_of_accounts", () => prisma.chartOfAccount.count({ where: { organizationId: org.id } })],
  ]
  console.log(`\nOther tables (AZMADE org):`)
  for (const [name, fn] of tables) {
    const c = await fn()
    console.log(`  ${name}: ${c}`)
  }

  const allOrgs = await prisma.organization.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: "asc" },
  })
  console.log(`\nAll orgs in DB (${allOrgs.length}):`)
  for (const o of allOrgs) console.log(`  - ${o.name} (slug=${o.slug}) [${o.id}]`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
