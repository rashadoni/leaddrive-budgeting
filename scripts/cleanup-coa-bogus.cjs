/**
 * Phase 7.G CLI follow-up — delete bogus ChartOfAccount rows created by
 * an old BalanceSheet-import that swapped column meanings, leaving 600+
 * rows with `code` being a decimal number like `10674531.74` and `name`
 * being another number `0.7178395933635285`.
 *
 * Keeps real SAP-style coded accounts (`601-*`, `701-*`, `711-*`, etc.).
 *
 * BudgetLine refs: 13 lines point at bogus accounts. The `accountId` FK
 * is `onDelete: SetNull` (per Prisma schema), so a delete just nulls
 * those references — BudgetLines retain their `category` text fallback
 * that the resolvers also read.
 *
 * Idempotent: re-run finds 0 bogus rows.
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!org) throw new Error("Org not found")

  const before = await prisma.chartOfAccount.count({ where: { organizationId: org.id } })
  console.log(`Total CoA before: ${before}`)

  // A code that's purely numeric (with optional decimal/leading-minus) =
  // bogus. Real SAP-coded entries have shape `^[0-9]{3}-[0-9]{2}` etc.
  const bogus = await prisma.$queryRaw`
    SELECT id FROM chart_of_accounts
    WHERE "organizationId" = ${org.id}
      AND (code ~ '^-?[0-9]+\.[0-9]+$' OR code ~ '^-?[0-9]+$')
      AND code !~ '^[0-9]{3}-'
  `
  const bogusIds = bogus.map((r) => r.id)
  console.log(`Bogus rows to delete: ${bogusIds.length}`)

  if (bogusIds.length === 0) {
    console.log("Nothing to clean.")
    await prisma.$disconnect()
    return
  }

  // accountId FK is `onDelete: SetNull` → BudgetLines auto-detach.
  const result = await prisma.chartOfAccount.deleteMany({
    where: { id: { in: bogusIds } },
  })
  console.log(`✓ Deleted ${result.count} bogus rows`)

  const after = await prisma.chartOfAccount.count({ where: { organizationId: org.id } })
  console.log(`Total CoA after: ${after}`)

  // Verify orphan BudgetLines
  const orphans = await prisma.budgetLine.count({
    where: { organizationId: org.id, accountId: null, accountType: { in: ["revenue", "cogs", "expense"] } },
  })
  console.log(`BudgetLines now with accountId=null (P&L type): ${orphans}`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
