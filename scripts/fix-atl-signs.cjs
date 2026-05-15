/**
 * Phase 7.H Feature 5 follow-up — flip ATL sign-flipped cogs/expense.
 *
 * Diagnose (scripts/diagnose-atl-signs.cjs) confirmed:
 *   - All ATL-DBZ/PMZ/TAZ/MRKZ BudgetLine rows have `accountId IS NULL`
 *     (the granular import didn't attach a chart_of_accounts FK, per
 *     CARRYOVER CL "Resolver lineType fallback").
 *   - cogs/expense rows are all stored as negative magnitude.
 *
 * The existing `fix-cogs-expense-signs.cjs` joins on accountId, so it
 * silently skips these rows. This script filters by `BudgetLine.lineType`
 * directly + scopes by `companyId IN (ATL-DBZ, ATL-PMZ, ATL-TAZ, ATL-MRKZ)`
 * so we don't accidentally flip a legitimate negative revenue/discount
 * elsewhere. Idempotent (re-running finds 0).
 *
 * Run: node scripts/fix-atl-signs.cjs
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const COMPANY_CODES = ["ATL-DBZ", "ATL-PMZ", "ATL-TAZ", "ATL-MRKZ"]

async function main() {
  const companies = await prisma.company.findMany({
    where: { code: { in: COMPANY_CODES } },
    select: { id: true, code: true },
  })
  const ids = companies.map((c) => c.id)
  if (ids.length === 0) {
    console.log("✗ None of ATL companies found — aborting.")
    return
  }
  console.log(`Scope: ${companies.map((c) => c.code).join(", ")} (${ids.length} companies)\n`)

  // Before snapshot per company per lineType (negative rows only).
  const before = await prisma.$queryRaw`
    SELECT c.code, bl."lineType",
           SUM(CASE WHEN bl."plannedAmount" < 0 THEN 1 ELSE 0 END)::int AS neg_rows,
           ROUND(SUM(CASE WHEN bl."plannedAmount" < 0 THEN bl."plannedAmount" ELSE 0 END)::numeric)::bigint AS neg_sum
    FROM budget_lines bl
    JOIN companies c ON c.id = bl."companyId"
    WHERE bl."companyId" = ANY(${ids}::text[])
      AND bl."lineType" IN ('cogs', 'expense')
    GROUP BY c.code, bl."lineType"
    ORDER BY c.code, bl."lineType"
  `
  console.log("=== BEFORE ===")
  let totalNeg = 0
  for (const r of before) {
    console.log(`  ${r.code.padEnd(10)} ${r.lineType.padEnd(8)} neg_rows=${String(r.neg_rows).padStart(5)}  neg_sum=${Number(r.neg_sum).toLocaleString()}`)
    totalNeg += r.neg_rows
  }
  if (totalNeg === 0) {
    console.log("\n  (none — DB already clean for ATL scope, exiting)")
    await prisma.$disconnect()
    return
  }

  // Flip plannedAmount + forecastAmount signs where plannedAmount < 0.
  const result = await prisma.$executeRaw`
    UPDATE budget_lines bl
    SET "plannedAmount" = ABS(bl."plannedAmount"),
        "forecastAmount" = CASE WHEN bl."forecastAmount" IS NOT NULL THEN ABS(bl."forecastAmount") ELSE NULL END
    WHERE bl."companyId" = ANY(${ids}::text[])
      AND bl."lineType" IN ('cogs', 'expense')
      AND bl."plannedAmount" < 0
  `
  console.log(`\n✓ Flipped ${result} rows`)

  // After snapshot — should be 0 negatives left.
  const after = await prisma.$queryRaw`
    SELECT c.code, bl."lineType", SUM(CASE WHEN bl."plannedAmount" < 0 THEN 1 ELSE 0 END)::int AS neg_rows
    FROM budget_lines bl
    JOIN companies c ON c.id = bl."companyId"
    WHERE bl."companyId" = ANY(${ids}::text[])
      AND bl."lineType" IN ('cogs', 'expense')
    GROUP BY c.code, bl."lineType"
    HAVING SUM(CASE WHEN bl."plannedAmount" < 0 THEN 1 ELSE 0 END) > 0
  `
  if (after.length === 0) console.log("✓ Verify: 0 negative cogs/expense rows remain in ATL scope")
  else for (const r of after) console.log(`  ⚠ ${r.code} ${r.lineType}: ${r.neg_rows} rows still negative`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
