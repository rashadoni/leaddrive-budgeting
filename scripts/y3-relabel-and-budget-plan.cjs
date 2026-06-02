/**
 * Y3 (decouple plan, Option Y) — relabel the actuals-holding plan + create the
 * real budget plan.
 *
 *  1. The year-2026 plan that actually holds data (kind=actual, >0 live lines)
 *     is named "Azərşəkər 2026 Budget" but holds 2026 ACTUALS → rename it to
 *     "Azərşəkər 2026 Actuals". (kind already "actual".)
 *  2. Create a fresh empty "Azərşəkər 2026 Budget" with kind="budget" for the
 *     real forward budget. The terminal ignores it (Y2 filter kind="actual");
 *     the budgeting dashboard's default-pick skips empty plans, so it keeps
 *     showing the actuals plan until a budget is loaded.
 *
 * Idempotent (keys off data, not the name) + reversible (prints the old name).
 * DRY RUN default; pass --apply to write.
 * Run: node scripts/y3-relabel-and-budget-plan.cjs [--apply]
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
const APPLY = process.argv.includes("--apply")
const ACTUALS_NAME = "Azərşəkər 2026 Actuals"
const BUDGET_NAME = "Azərşəkər 2026 Budget"

async function main() {
  const org = await prisma.organization.findFirst({ select: { id: true } })
  // The data-holding 2026 actuals plan (kind=actual + has live lines).
  const plans = await prisma.budgetPlan.findMany({
    where: { organizationId: org.id, year: 2026, deletedAt: null },
    select: { id: true, name: true, kind: true, periodType: true, status: true, _count: { select: { lines: { where: { deletedAt: null } } } } },
  })
  const actuals = plans.find((p) => p.kind === "actual" && p._count.lines > 0)
  if (!actuals) throw new Error("ABORT: no kind=actual 2026 plan with live lines found")
  const existingBudget = plans.find((p) => p.kind === "budget")

  console.log(`Actuals plan: "${actuals.name}" (id ${actuals.id.slice(0, 10)}, ${actuals._count.lines} live lines)`)
  console.log(`  → rename to "${ACTUALS_NAME}": ${actuals.name === ACTUALS_NAME ? "already named, skip" : "WILL RENAME"}`)
  console.log(`Budget plan (kind=budget): ${existingBudget ? `exists "${existingBudget.name}"` : "WILL CREATE empty"}`)

  if (!APPLY) { console.log("\nDRY RUN — no writes. Re-run with --apply."); await prisma.$disconnect(); return }

  if (actuals.name !== ACTUALS_NAME) {
    console.log(`\n[revert note] original name was: "${actuals.name}"`)
    await prisma.budgetPlan.update({ where: { id: actuals.id }, data: { name: ACTUALS_NAME } })
    console.log(`Renamed → "${ACTUALS_NAME}"`)
  }
  if (!existingBudget) {
    const created = await prisma.budgetPlan.create({
      data: { organizationId: org.id, name: BUDGET_NAME, year: 2026, periodType: actuals.periodType, status: "draft", kind: "budget" },
      select: { id: true },
    })
    console.log(`Created budget plan "${BUDGET_NAME}" (id ${created.id.slice(0, 10)}, kind=budget, 0 lines)`)
  }

  // Verify checksum on the actuals plan unchanged.
  const agg = await prisma.budgetLine.aggregate({ where: { planId: actuals.id, deletedAt: null }, _sum: { plannedAmount: true }, _count: { _all: true } })
  console.log(`\nActuals plan checksum: ${Math.round((agg._sum.plannedAmount + Number.EPSILON) * 100) / 100} (${agg._count._all} lines) — expect 21828325.86 / 732`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1) })
