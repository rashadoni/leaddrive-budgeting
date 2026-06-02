/**
 * Y5b read-only verification: confirm the AI-import routing TARGETS are
 * correct against live data.
 *  - Lists every 2026 BudgetPlan with its kind + BudgetLine count.
 *  - Asserts exactly one "actual" plan (terminal P&L source, populated)
 *    and the "budget" plan (execution target) exist.
 * NO writes. Pure SELECTs.
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const org = await prisma.organization.findFirst({ select: { id: true, name: true } })
  if (!org) throw new Error("no organization")
  console.log(`Org: ${org.name} (${org.id})`)

  const plans = await prisma.budgetPlan.findMany({
    where: { organizationId: org.id, year: 2026, deletedAt: null },
    select: { id: true, name: true, kind: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })

  console.log(`\n2026 plans (${plans.length}):`)
  for (const p of plans) {
    const lineCount = await prisma.budgetLine.count({ where: { planId: p.id } })
    const bsCount = await prisma.balanceSheetLine.count({ where: { planId: p.id } })
    const actualCount = await prisma.budgetActual.count({ where: { planId: p.id } })
    console.log(
      `  [${p.kind.padEnd(6)}] ${p.name.padEnd(32)} ` +
        `BudgetLine=${lineCount}  BS=${bsCount}  BudgetActual=${actualCount}`,
    )
  }

  const actuals = plans.filter((p) => p.kind === "actual")
  const budgets = plans.filter((p) => p.kind === "budget")
  console.log(`\nKind summary: actual=${actuals.length}, budget=${budgets.length}`)

  // Decouple invariants
  const problems = []
  if (actuals.length !== 1) problems.push(`expected exactly 1 actual plan, got ${actuals.length}`)
  if (budgets.length < 1) problems.push(`expected >=1 budget plan, got ${budgets.length}`)
  if (actuals.length === 1) {
    const n = await prisma.budgetLine.count({ where: { planId: actuals[0].id } })
    if (n === 0) problems.push(`actuals plan ${actuals[0].name} is EMPTY (terminal would show nothing)`)
  }

  if (problems.length) {
    console.log(`\n❌ INVARIANT FAILURES:`)
    for (const p of problems) console.log(`   - ${p}`)
    process.exitCode = 1
  } else {
    console.log(`\n✅ Routing targets correct: 1 populated actuals plan + budget plan(s) exist.`)
    console.log(`   PLF/BS/CF "actual" sheets → actuals plan (terminal P&L).`)
    console.log(`   BUDGET_ACTUALS / budget-section sheets → budget plan (execution %).`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
