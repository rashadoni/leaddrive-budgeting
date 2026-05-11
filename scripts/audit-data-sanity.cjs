const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })

  // 1. Stale plans?
  console.log("\n=== ALL 2026 plans (incl. soft-deleted) ===")
  const plans = await prisma.budgetPlan.findMany({
    where: { organizationId: org.id, year: 2026 },
    select: { id: true, name: true, status: true, deletedAt: true, _count: { select: { lines: true, actuals: true } } },
    orderBy: { createdAt: "desc" },
  })
  for (const p of plans) console.log(`  ${(p.deletedAt ? "DEL" : "OK ").padEnd(4)} ${p.status.padEnd(8)} ${p.name.padEnd(40)} lines=${p._count.lines} actuals=${p._count.actuals}`)

  // 2. Negative values? (Azərşəkər had -33M cogs etc.)
  console.log("\n=== Negative plannedAmount counts (should be 0 for revenue/cogs/expense) ===")
  const neg = await prisma.$queryRaw`
    SELECT c.code AS co, coa."accountType",
           COUNT(*)::int AS neg_n,
           ROUND(SUM(bl."plannedAmount")::numeric)::int AS sum
    FROM budget_lines bl
    JOIN companies c ON c.id = bl."companyId"
    JOIN budget_plans bp ON bp.id = bl."planId"
    LEFT JOIN chart_of_accounts coa ON coa.id = bl."accountId"
    WHERE c."organizationId" = ${org.id}
      AND bp.year = 2026 AND bp."deletedAt" IS NULL
      AND bl."plannedAmount" < 0
    GROUP BY c.code, coa."accountType"
    HAVING COUNT(*) > 0
    ORDER BY c.code, coa."accountType"
  `
  for (const r of neg) console.log(`  ${r.co.padEnd(20)} ${String(r.accountType ?? '(null)').padEnd(15)} ${String(r.neg_n).padStart(5)} rows  sum=${(r.sum/1000).toFixed(0)}K`)

  // 3. Stale IndicatorValues (rows for companies that no longer exist or wrong period)?
  console.log("\n=== IndicatorValue → orphan companies (deleted/missing) ===")
  const orphans = await prisma.$queryRaw`
    SELECT iv.period, iv.status, COUNT(*)::int AS n
    FROM indicator_values iv
    LEFT JOIN companies c ON c.id = iv."companyId"
    WHERE iv."organizationId" = ${org.id}
      AND (c.id IS NULL OR c."isActive" = false)
    GROUP BY iv.period, iv.status
    ORDER BY iv.period
  `
  if (orphans.length === 0) console.log("  (none — all IVs link to active companies)")
  else for (const r of orphans) console.log(`  period=${r.period} status=${r.status} n=${r.n}`)

  // 4. Budget plans showing in UI vs actually used (any 2025 leftover?)
  console.log("\n=== ALL plans across all years ===")
  const allPlans = await prisma.budgetPlan.groupBy({
    by: ["year", "status"],
    where: { organizationId: org.id, deletedAt: null },
    _count: { _all: true },
  })
  for (const r of allPlans) console.log(`  ${r.year} ${r.status.padEnd(8)} ${r._count._all} plan(s)`)

  // 5. Cash flow entries — by company prefix
  console.log("\n=== CashFlowEntry distribution ===")
  const cf = await prisma.$queryRaw`
    SELECT split_part(category, ':', 1) AS prefix, COUNT(*)::int AS n
    FROM cash_flow_entries WHERE "organizationId" = ${org.id} AND year = 2026
    GROUP BY split_part(category, ':', 1) ORDER BY n DESC
  `
  for (const r of cf) console.log(`  ${(r.prefix || "(no prefix)").padEnd(20)} ${r.n}`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
