/**
 * Phase 7.G CXLII — clean up "Demo Holdings *" BudgetPlan rows that linger
 * under AZMADE org. They're empty (0 BudgetLines) artefacts from disabled
 * seed scripts. Cleanup-fake-azmade-data.cjs deletes data INSIDE plans but
 * not plan rows themselves.
 *
 * Run: `node scripts/cleanup-demo-budget-plans.cjs [--execute]`
 *
 * Safety: only deletes plans whose name starts with "Demo " AND have 0
 * BudgetLines. Real plans like "AZMADE 2026 Budget" are NEVER touched.
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
const DRY_RUN = !process.argv.includes("--execute")

async function main() {
  const azmade = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!azmade) { console.log("AZMADE org not found"); return }

  const candidates = await prisma.budgetPlan.findMany({
    where: { organizationId: azmade.id, name: { startsWith: "Demo " } },
    select: { id: true, name: true, year: true, _count: { select: { lines: true, actuals: true } } },
  })

  console.log(`\n=== ${DRY_RUN ? "DRY-RUN" : "EXECUTING"} — Demo BudgetPlan cleanup ===\n`)
  console.log(`Found ${candidates.length} candidates with name starting "Demo ":`)
  for (const p of candidates) {
    const safe = p._count.lines === 0 && p._count.actuals === 0
    console.log(`  ${safe ? "✓ safe" : "⚠ HAS DATA"}: "${p.name}" (${p.year}) — lines=${p._count.lines}, actuals=${p._count.actuals}`)
  }

  if (DRY_RUN) { await prisma.$disconnect(); return }

  let deleted = 0
  for (const p of candidates) {
    if (p._count.lines !== 0 || p._count.actuals !== 0) {
      console.log(`  SKIP "${p.name}" — has data, refusing to delete`)
      continue
    }
    await prisma.budgetPlan.delete({ where: { id: p.id } })
    deleted++
  }
  console.log(`\n=== DONE: ${deleted} demo plans deleted ===`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
