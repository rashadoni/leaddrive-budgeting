/**
 * Phase 7.H Feature 5 follow-up — list which BudgetPlan(s) each ATL
 * company has rows in. Hypothesis: leftover rows from an earlier
 * SOPL-import plan are inflating expense totals beyond what the
 * Input PL detailed import wrote.
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const codes = ["ATL-DBZ", "ATL-PMZ", "ATL-TAZ", "ATL-MRKZ"]
  for (const code of codes) {
    const c = await prisma.company.findFirst({ where: { code } })
    if (!c) continue
    const byPlan = await prisma.$queryRaw`
      SELECT bp.name AS plan_name, bp.id AS plan_id, COUNT(*)::int AS rows,
             ROUND(SUM(CASE WHEN bl."lineType"='revenue' THEN bl."plannedAmount" ELSE 0 END)::numeric)::bigint AS rev,
             ROUND(SUM(CASE WHEN bl."lineType"='cogs' THEN bl."plannedAmount" ELSE 0 END)::numeric)::bigint AS cogs,
             ROUND(SUM(CASE WHEN bl."lineType"='expense' THEN bl."plannedAmount" ELSE 0 END)::numeric)::bigint AS exp,
             ROUND(SUM(CASE WHEN bl."lineType"='bs' THEN bl."plannedAmount" ELSE 0 END)::numeric)::bigint AS bs
      FROM budget_lines bl
      JOIN budget_plans bp ON bp.id = bl."planId"
      WHERE bl."companyId" = ${c.id}
      GROUP BY bp.name, bp.id
      ORDER BY bp.name
    `
    console.log(`\n${code}:`)
    for (const r of byPlan) {
      console.log(`  Plan "${r.plan_name}" (${r.plan_id}): ${r.rows} rows  rev=${Number(r.rev||0).toLocaleString()}  cogs=${Number(r.cogs||0).toLocaleString()}  exp=${Number(r.exp||0).toLocaleString()}  bs=${Number(r.bs||0).toLocaleString()}`)
    }
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
