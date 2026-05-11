const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" } })

  console.log("=== BudgetPlan coverage ===")
  const plans = await prisma.budgetPlan.findMany({
    where: { organizationId: org.id, deletedAt: null },
    select: { name: true, year: true, status: true, _count: { select: { lines: true, actuals: true } } },
    orderBy: { year: "asc" },
  })
  for (const p of plans) console.log(`  ${p.year} ${p.status.padEnd(8)} ${p.name.padEnd(40)} lines=${p._count.lines} actuals=${p._count.actuals}`)

  console.log("\n=== BudgetLine month coverage by year (per BudgetPlan.year) ===")
  const months = await prisma.$queryRaw`
    SELECT bp.year, bl."monthIndex", COUNT(*)::int AS n
    FROM budget_lines bl
    JOIN budget_plans bp ON bp.id = bl."planId"
    WHERE bp."organizationId" = ${org.id} AND bp."deletedAt" IS NULL
    GROUP BY bp.year, bl."monthIndex"
    ORDER BY bp.year, bl."monthIndex"
  `
  for (const r of months) console.log(`  ${r.year} M${(r.monthIndex ?? 'null').toString().padStart(2)}  ${r.n}`)

  console.log("\n=== CashFlow coverage by year/month ===")
  const cf = await prisma.cashFlowEntry.groupBy({
    by: ["year", "month"],
    where: { organizationId: org.id },
    _count: { _all: true },
  })
  for (const r of cf.sort((a,b) => a.year - b.year || a.month - b.month)) console.log(`  ${r.year} M${String(r.month).padStart(2)}  ${r._count._all}`)

  console.log("\n=== Actuals coverage ===")
  const actuals = await prisma.budgetActual.groupBy({
    by: ["year", "month"],
    where: { organizationId: org.id },
    _count: { _all: true },
  })
  if (actuals.length === 0) console.log("  (no actuals)")
  else for (const r of actuals) console.log(`  ${r.year} M${String(r.month).padStart(2)}  ${r._count._all}`)

  console.log("\n=== BalanceSheet coverage ===")
  const bs = await prisma.balanceSheetLine.groupBy({
    by: ["year", "month"],
    where: { organizationId: org.id },
    _count: { _all: true },
  })
  if (bs.length === 0) console.log("  (no BS data)")
  else for (const r of bs.sort((a,b) => a.year - b.year || a.month - b.month).slice(0, 24)) console.log(`  ${r.year} M${String(r.month).padStart(2)}  ${r._count._all}`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
