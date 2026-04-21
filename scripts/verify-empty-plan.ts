/**
 * Empty plan safety verification.
 *
 * Simulates what happens when the user clicks "Create plan" after a reimport:
 *   1. Find the existing live plan (used as a sibling to check period-conflict)
 *   2. Create a brand-new plan with a different name but SAME period (annual,
 *      2026) — this is the harshest case for the duplicate check and the
 *      analytics/queries that take planId.
 *   3. Call every analytics-shaped query the UI depends on against the empty
 *      plan: budgetLine findMany, pnl lines, balance-sheet lines, COGS,
 *      assumptions, forecast entries. Each must return without throwing.
 *   4. Cleanup the test plan.
 */

import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

async function main() {
  const ref = await prisma.budgetPlan.findFirst({
    where: { name: "Budget 2026 (Imported)", deletedAt: null },
  })
  if (!ref) {
    console.error("No live reference plan — aborting")
    process.exit(1)
  }

  // Create a brand-new empty plan with a distinct name but same period/year
  const empty = await prisma.budgetPlan.create({
    data: {
      organizationId: ref.organizationId,
      name: `__verify_empty_${Date.now()}`,
      periodType: "annual",
      year: ref.year,
      status: "draft",
    },
  })
  console.log(`Created empty plan ${empty.id}`)

  const checks: Array<[string, () => Promise<unknown>]> = [
    ["budgetLine.findMany", () =>
      prisma.budgetLine.findMany({
        where: { planId: empty.id },
        include: { account: { select: { code: true, name: true } } },
      }),
    ],
    ["balanceSheetLine.findMany", () =>
      prisma.balanceSheetLine.findMany({ where: { planId: empty.id } }),
    ],
    ["cOGSBudgetLine.findMany", () =>
      prisma.cOGSBudgetLine.findMany({ where: { planId: empty.id } }),
    ],
    ["cOGSCostDetail.findMany", () =>
      prisma.cOGSCostDetail.findMany({ where: { planId: empty.id } }),
    ],
    ["budgetAssumption.findMany", () =>
      prisma.budgetAssumption.findMany({ where: { planId: empty.id } }),
    ],
    ["budgetForecastEntry.findMany", () =>
      prisma.budgetForecastEntry.findMany({ where: { planId: empty.id } }),
    ],
    ["budgetActual.findMany", () =>
      prisma.budgetActual.findMany({ where: { planId: empty.id } }),
    ],
    ["budgetApprovalComment.findMany", () =>
      prisma.budgetApprovalComment.findMany({ where: { planId: empty.id } }),
    ],
    ["budgetChangeLog.findMany", () =>
      prisma.budgetChangeLog.findMany({ where: { planId: empty.id } }),
    ],
    ["savedBudgetReport.findMany", () =>
      prisma.savedBudgetReport.findMany({ where: { planId: empty.id } }),
    ],
    ["rollingForecastMonth.findMany", () =>
      prisma.rollingForecastMonth.findMany({ where: { planId: empty.id } }),
    ],
  ]

  let passed = 0
  let failed = 0
  for (const [name, fn] of checks) {
    try {
      const result = (await fn()) as unknown[]
      console.log(`  ${name.padEnd(36)} ✓  returned ${result.length} rows`)
      passed++
    } catch (err) {
      console.log(`  ${name.padEnd(36)} ✗  ${(err as Error).message}`)
      failed++
    }
  }

  // Cleanup
  await prisma.budgetPlan.delete({ where: { id: empty.id } })
  console.log(`\nCleaned up ${empty.id}`)

  if (failed === 0) {
    console.log(`\n✅ PASS — ${passed} queries OK against empty plan`)
  } else {
    console.log(`\n❌ FAIL — ${failed}/${passed + failed} queries threw`)
    process.exit(1)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
