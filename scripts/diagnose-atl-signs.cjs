/**
 * Phase 7.H Feature 5 follow-up — diagnose ATL sign-flip scope.
 *
 * verify-all-vs-xlsx flagged ATL-DBZ/PMZ/TAZ with negative cogs/expense in
 * DB, but the existing fix-cogs-expense-signs.cjs (which joins chart_of_accounts)
 * reports "none found". Hypothesis: ATL detailed imports landed without
 * accountId (the "Resolver lineType fallback" path mentioned in CARRYOVER CL).
 *
 * This dry-run reports per-company per-lineType counts of negative-amount
 * rows + accountId NULL counts so the fix script can be widened safely.
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const codes = ["ATL-DBZ", "ATL-PMZ", "ATL-TAZ", "ATL-MRKZ", "LLS-MAIN"]
  for (const code of codes) {
    const c = await prisma.company.findFirst({ where: { code }, select: { id: true } })
    if (!c) { console.log(`✗ ${code} not found`); continue }
    const byTypeSign = await prisma.$queryRaw`
      SELECT "lineType",
             SUM(CASE WHEN "plannedAmount" < 0 THEN 1 ELSE 0 END)::int AS neg,
             SUM(CASE WHEN "plannedAmount" >= 0 THEN 1 ELSE 0 END)::int AS pos,
             SUM(CASE WHEN "accountId" IS NULL THEN 1 ELSE 0 END)::int AS null_account,
             ROUND(SUM(CASE WHEN "plannedAmount" < 0 THEN "plannedAmount" ELSE 0 END)::numeric)::bigint AS neg_sum
      FROM budget_lines
      WHERE "companyId" = ${c.id}
      GROUP BY "lineType"
      ORDER BY "lineType"
    `
    console.log(`\n${code} (companyId=${c.id}):`)
    for (const r of byTypeSign) {
      console.log(`  ${String(r.lineType).padEnd(10)} pos=${String(r.pos).padStart(5)}  neg=${String(r.neg).padStart(5)}  null_account=${String(r.null_account).padStart(5)}  neg_sum=${r.neg_sum ?? 0}`)
    }
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
