/**
 * Phase 7.G CXLIX — cleanup leftover testing artifacts.
 *
 * 1. Delete stale "Q1" BudgetPlan (1716 lines, 0 actuals — created during
 *    earlier testing, never used by recompute, pollutes Plans UI).
 * 2. Delete CashFlowEntry rows that have no company prefix in `category`
 *    (legacy entries from before CXXXVIII per-company prefix fix; pollute
 *    consolidated CF view).
 *
 * Both are non-destructive in practice:
 *  - Q1 plan has 0 actuals (verified before delete)
 *  - Orphan CF entries don't match any company's filtered view
 *
 * Idempotent: re-running finds nothing to delete.
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!org) throw new Error("Org 'azmade' not found")

  // --- 1. Delete stale Q1 plan ---
  const q1 = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, year: 2026, name: "Q1", deletedAt: null },
    select: { id: true, _count: { select: { lines: true, actuals: true } } },
  })
  if (!q1) {
    console.log("✓ Q1 plan already absent (clean)")
  } else if (q1._count.actuals > 0) {
    console.log(`⚠ Q1 plan has ${q1._count.actuals} actuals — NOT deleting (would lose data)`)
  } else {
    // Hard-delete (cascade lines via Prisma onDelete)
    await prisma.budgetPlan.delete({ where: { id: q1.id } })
    console.log(`✓ Deleted Q1 plan (id=${q1.id}, lines=${q1._count.lines})`)
  }

  // --- 2. Orphan CashFlowEntry cleanup ---
  // Per CXXXVIII fix, entries should have category prefix like "AAC-MAIN: Label".
  // Pre-fix entries had category=NULL (created by an earlier import/seed
  // path that didn't fill the field) — they pollute the consolidated CF
  // view and have no company linkage to filter by.
  const orphanCount = await prisma.cashFlowEntry.count({
    where: { organizationId: org.id, year: 2026, category: null },
  })
  console.log(`\nOrphan CF entries (category=NULL): ${orphanCount}`)
  if (orphanCount > 0) {
    const result = await prisma.cashFlowEntry.deleteMany({
      where: { organizationId: org.id, year: 2026, category: null },
    })
    console.log(`✓ Deleted ${result.count} orphan CF entries`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
