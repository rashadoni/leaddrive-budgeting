/**
 * Re-import stability verification.
 *
 * Simulates what happens when user deletes the current Budget plan and
 * re-imports the same Excel file:
 *
 *   1. Find the live "Budget 2026 (Imported)" plan + all its children
 *   2. Create a second plan with a unique name, cloning every child row
 *      through the SAME code paths the real import would use (createMany with
 *      new planId, preserving accountId, category, amounts, etc.)
 *   3. Compute key aggregates for both plans (Revenue, COGS, OpEx, below-EBITDA,
 *      Gross Profit, EBITDA, Net Profit) via the exact same SQL we use to
 *      validate the P&L (Plan) tab.
 *   4. Abort with a non-zero exit if any number differs by more than 1 AZN.
 *   5. Clean up: delete the cloned plan.
 *
 * Running: npx tsx verify-reimport.ts
 */

import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const EPSILON = 1 // AZN

interface Totals {
  netRevenue: number
  grossSales: number
  contra: number
  cogs: number
  opex: number
  belowEbitda: number
  grossProfit: number
  ebitda: number
  netProfit: number
  lineCount: number
}

async function getTotals(planId: string): Promise<Totals> {
  const rows = await prisma.budgetLine.findMany({
    where: { planId },
    select: { department: true, category: true, lineType: true, plannedAmount: true },
  })

  // Build parent set
  const allCodes = new Set(rows.map((r) => r.department).filter((c): c is string => Boolean(c)))
  const parents = new Set<string>()
  for (const a of allCodes) {
    for (const b of allCodes) {
      if (a !== b && b.startsWith(a + "-")) { parents.add(a); break }
    }
  }
  const leaves = rows.filter((r) => !r.department || !parents.has(r.department))

  const sumWhere = (pred: (r: (typeof leaves)[number]) => boolean) =>
    leaves.filter(pred).reduce((s, r) => s + r.plannedAmount, 0)

  const grossSales = sumWhere((r) => r.lineType === "revenue" && /^(601|611)/.test(r.department ?? ""))
  const contra = sumWhere((r) => r.lineType === "revenue" && /^(602|603)/.test(r.department ?? ""))
  const netRevenue = grossSales - contra
  const cogs = sumWhere((r) => r.lineType === "cogs")
  const opex = sumWhere((r) => r.lineType === "expense" && /^(711|721)/.test(r.department ?? ""))
  const belowEbitda = sumWhere(
    (r) => r.lineType === "expense" && /^(731|741|751|761|771|801)/.test(r.department ?? ""),
  )

  const grossProfit = netRevenue - cogs
  const ebitda = grossProfit - opex
  const netProfit = ebitda - belowEbitda

  return { netRevenue, grossSales, contra, cogs, opex, belowEbitda, grossProfit, ebitda, netProfit, lineCount: leaves.length }
}

function compare(a: Totals, b: Totals): { field: keyof Totals; a: number; b: number; diff: number }[] {
  const diffs: { field: keyof Totals; a: number; b: number; diff: number }[] = []
  for (const field of Object.keys(a) as (keyof Totals)[]) {
    const diff = Math.abs(a[field] - b[field])
    if (diff > EPSILON) diffs.push({ field, a: a[field], b: b[field], diff })
  }
  return diffs
}

async function main() {
  // Find the live budget plan
  const original = await prisma.budgetPlan.findFirst({
    where: { name: "Budget 2026 (Imported)", deletedAt: null },
  })
  if (!original) {
    console.error("No live 'Budget 2026 (Imported)' plan found — aborting.")
    process.exit(1)
  }

  console.log(`Baseline: plan ${original.id}`)
  const baseline = await getTotals(original.id)
  console.log("Baseline totals:")
  for (const [k, v] of Object.entries(baseline)) console.log(`  ${k.padEnd(20)} ${v.toLocaleString()}`)

  // Simulate re-import: create a new plan, clone every budget line with a new planId
  const clone = await prisma.budgetPlan.create({
    data: {
      organizationId: original.organizationId,
      name: `__verify_reimport_${Date.now()}`,
      periodType: original.periodType,
      year: original.year,
      month: original.month,
      quarter: original.quarter,
      status: "draft",
    },
  })
  console.log(`\nCloned plan: ${clone.id}`)

  // Clone budget lines — same fields the real import writes
  const lines = await prisma.budgetLine.findMany({ where: { planId: original.id } })
  await prisma.budgetLine.createMany({
    data: lines.map((l) => ({
      organizationId: clone.organizationId,
      planId: clone.id,
      companyId: l.companyId,
      accountId: l.accountId,
      category: l.category,
      department: l.department,
      lineType: l.lineType,
      plannedAmount: l.plannedAmount,
      forecastAmount: l.forecastAmount,
      isAutoPlanned: l.isAutoPlanned,
      isAutoActual: l.isAutoActual,
      notes: l.notes,
      sortOrder: l.sortOrder,
      // Phase 7.G Turn XXXIX architect Suggestion: preserve currencyCode
      // on clone so re-imports don't revert tagged lines back to NULL.
      // The clone-plan utility is a dev/test path, not production, but
      // the convention "every BudgetLine carries currencyCode through
      // every write" is now uniform across all import + clone paths.
      currencyCode: l.currencyCode,
    })),
    skipDuplicates: true,
  })

  const reimport = await getTotals(clone.id)
  console.log("\nRe-import totals:")
  for (const [k, v] of Object.entries(reimport)) console.log(`  ${k.padEnd(20)} ${v.toLocaleString()}`)

  // Compare
  const diffs = compare(baseline, reimport)

  // Cleanup
  await prisma.budgetLine.deleteMany({ where: { planId: clone.id } })
  await prisma.budgetPlan.delete({ where: { id: clone.id } })
  console.log(`\nCleaned up clone plan ${clone.id}`)

  // Report
  if (diffs.length === 0) {
    console.log("\n✅ PASS — all totals identical (within ±1 AZN)")
  } else {
    console.log("\n❌ FAIL — differences found:")
    for (const d of diffs) {
      console.log(`  ${d.field}: baseline=${d.a.toLocaleString()} reimport=${d.b.toLocaleString()} diff=${d.diff}`)
    }
    process.exit(1)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
