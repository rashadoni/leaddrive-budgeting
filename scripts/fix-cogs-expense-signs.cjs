/**
 * Phase 7.G CXLIX — flip sign on cogs/expense BudgetLine rows where amount < 0.
 *
 * Root cause: Azərşəkər (and partly AAC) xlsx files store cogs + expense values
 * as NEGATIVE numbers (xlsx convention: outflows are negative, so the sheet's
 * gross-margin formula is `gross = revenue + cogs` where cogs is already
 * signed). Imports preserved the sign. Our risk resolver computes
 * `gross_profit = revenue - cogs` expecting cogs as a POSITIVE magnitude;
 * with negative cogs, gross_profit is inflated (e.g. AZSEKER-EDEN: revenue
 * 50.3M - cogs (-33.2M) = 83.5M gross_profit; gross_margin = 165% — impossible).
 *
 * Fix: flip sign on cogs/expense rows where plannedAmount < 0. Standard
 * accounting practice: store as positive magnitude, sign implied by
 * accountType. Idempotent (re-running finds 0 to update).
 *
 * Revenue rows with negative amounts are LEFT ALONE — those are legitimate
 * returns/discounts and net-out correctly in the sum (the formula stays
 * mathematically correct: net_revenue = sum(revenue lines)).
 *
 * Run: node scripts/fix-cogs-expense-signs.cjs
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!org) throw new Error("Org 'azmade' not found")

  // Per-bucket dry-run counts before mutation
  const before = await prisma.$queryRaw`
    SELECT coa."accountType", COUNT(*)::int AS n, ROUND(SUM(bl."plannedAmount")::numeric)::bigint AS sum
    FROM budget_lines bl
    JOIN chart_of_accounts coa ON coa.id = bl."accountId"
    WHERE bl."organizationId" = ${org.id}
      AND bl."plannedAmount" < 0
      AND coa."accountType" IN ('cogs', 'expense')
    GROUP BY coa."accountType"
  `
  console.log("\n=== BEFORE (negative cogs/expense rows to flip) ===")
  for (const r of before) console.log(`  ${r.accountType.padEnd(10)} ${String(r.n).padStart(6)} rows  sum=${(Number(r.sum)/1000).toFixed(0)}K`)
  if (before.length === 0) {
    console.log("  (none — DB is already clean, exiting)")
    await prisma.$disconnect()
    return
  }

  // SQL UPDATE with CTE to scope by accountType (Prisma can't do filter-by-relation in updateMany).
  const result = await prisma.$executeRaw`
    UPDATE budget_lines bl
    SET "plannedAmount" = ABS(bl."plannedAmount"),
        "forecastAmount" = CASE WHEN bl."forecastAmount" IS NOT NULL THEN ABS(bl."forecastAmount") ELSE NULL END
    FROM chart_of_accounts coa
    WHERE bl."accountId" = coa.id
      AND bl."organizationId" = ${org.id}
      AND bl."plannedAmount" < 0
      AND coa."accountType" IN ('cogs', 'expense')
  `
  console.log(`\n✓ Flipped sign on ${result} cogs/expense rows`)

  const after = await prisma.$queryRaw`
    SELECT coa."accountType", COUNT(*)::int AS n
    FROM budget_lines bl
    JOIN chart_of_accounts coa ON coa.id = bl."accountId"
    WHERE bl."organizationId" = ${org.id}
      AND bl."plannedAmount" < 0
      AND coa."accountType" IN ('cogs', 'expense')
    GROUP BY coa."accountType"
  `
  if (after.length === 0) console.log("✓ Verify: 0 negative cogs/expense rows remain")
  else for (const r of after) console.log(`  ⚠ ${r.accountType}: ${r.n} rows still negative`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
