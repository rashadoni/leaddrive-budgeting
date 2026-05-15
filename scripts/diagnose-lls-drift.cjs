/**
 * LLS-MAIN drift diagnosis: 86K higher cogs+exp in DB vs SOPL parse.
 * List every DB BudgetLine for LLS-MAIN grouped by category, see if
 * one specific account is over-counted.
 */
const { PrismaClient } = require("@prisma/client")
const XLSX = require("xlsx")
const prisma = new PrismaClient()

async function main() {
  const c = await prisma.company.findFirst({ where: { code: "LLS-MAIN" } })
  if (!c) return
  // DB aggregates per category (12 months summed)
  const dbAgg = await prisma.$queryRaw`
    SELECT category, "lineType",
           ROUND(SUM("plannedAmount")::numeric)::bigint AS amount,
           COUNT(*)::int AS rows
    FROM budget_lines
    WHERE "companyId" = ${c.id} AND "lineType" IN ('cogs', 'expense')
    GROUP BY category, "lineType"
    ORDER BY amount DESC
  `
  console.log(`DB LLS-MAIN cogs/expense by category (top 25 by |amount|):`)
  for (const r of dbAgg.slice(0, 25)) {
    console.log(`  ${String(r.lineType).padEnd(8)} ${String(r.rows).padStart(3)}rows  ${Number(r.amount).toLocaleString().padStart(12)}  ${r.category}`)
  }
  console.log(`  ... total ${dbAgg.length} categories`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
