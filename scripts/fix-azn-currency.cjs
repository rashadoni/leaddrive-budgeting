/**
 * Phase 7.G CXLVIII — clear redundant `currencyCode='AZN'` tag on base-currency
 * BudgetLine rows.
 *
 * Problem: import scripts stamped every line with `currencyCode='AZN'` (the
 * base currency for FO Holding) but no `exchangeRate`. The resolver at
 * `src/lib/risk/recompute.ts:982` skips ANY line where `currencyCode != null
 * && exchangeRate == null` (it can't safely assume rate=1) — so 100% of
 * BudgetLines were excluded from revenue/cogs/opex aggregation, producing 86
 * `unknown` IndicatorValues across the matrix.
 *
 * Fix: clear `currencyCode` on lines where it equals base. The resolver
 * treats `currencyCode === null` as base-currency (no FX conversion needed).
 *
 * Followup committed alongside: import scripts updated to NOT stamp the base
 * currency on new imports.
 *
 * Idempotent: re-running finds 0 rows to update.
 *
 * Run: `node scripts/fix-azn-currency.cjs`
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!org) throw new Error("Org 'azmade' not found")
  // FO Holding base currency is AZN — companies are AZ-based; AZN ≡ base ≡ no foreign-currency tag.
  const BASE = "AZN"

  const before = await prisma.budgetLine.count({
    where: { organizationId: org.id, currencyCode: BASE },
  })
  console.log(`Lines with currencyCode='${BASE}' (base): ${before}`)

  const result = await prisma.budgetLine.updateMany({
    where: { organizationId: org.id, currencyCode: BASE },
    data: { currencyCode: null },
  })
  console.log(`✓ Cleared currencyCode on ${result.count} lines`)

  const after = await prisma.budgetLine.count({
    where: { organizationId: org.id, currencyCode: BASE },
  })
  console.log(`Lines with currencyCode='${BASE}' after: ${after}`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
