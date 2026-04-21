import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const MONTH_NAMES = ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"]

// Plan vs Fact dashboard — monthly revenue/expense plan vs actual
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const year = parseInt(req.nextUrl.searchParams.get("year") || new Date().getFullYear().toString())

  // Get planned amounts from budget lines
  const budgetLines = await prisma.budgetLine.findMany({
    where: {
      organizationId: orgId,
      plan: { year, status: { in: ["approved", "draft"] } },
    },
    select: { lineType: true, plannedAmount: true, department: true },
  })

  // Get actual amounts
  const budgetActuals = await prisma.budgetActual.findMany({
    where: { organizationId: orgId, plan: { year } },
    select: { lineType: true, actualAmount: true, expenseDate: true, department: true },
  })

  // Get sales forecasts for planned revenue by month
  const salesForecasts = await prisma.salesForecast.findMany({
    where: { organizationId: orgId, year },
    include: { budgetDept: { select: { label: true } } },
  })

  // Get expense forecasts for planned expenses by month
  const expenseForecasts = await prisma.expenseForecast.findMany({
    where: { organizationId: orgId, year },
    include: { budgetCostType: { select: { label: true } } },
  })

  // Build monthly plan vs fact
  const monthly = []
  for (let m = 1; m <= 12; m++) {
    // Revenue plan: from SalesForecast
    const revenuePlan = salesForecasts
      .filter((f: typeof salesForecasts[number]) => f.month === m)
      .reduce((s: number, f: typeof salesForecasts[number]) => s + (f.amount || 0), 0)

    // Revenue fact: from BudgetActual
    const revenueFact = budgetActuals
      .filter((a: typeof budgetActuals[number]) => a.lineType === "revenue" && a.expenseDate && new Date(a.expenseDate).getMonth() + 1 === m)
      .reduce((s: number, a: typeof budgetActuals[number]) => s + (a.actualAmount || 0), 0)

    // Expense plan: from ExpenseForecast
    const expensePlan = expenseForecasts
      .filter((f: typeof expenseForecasts[number]) => f.month === m)
      .reduce((s: number, f: typeof expenseForecasts[number]) => s + (f.amount || 0), 0)

    // Expense fact: from BudgetActual
    const expenseFact = budgetActuals
      .filter((a: typeof budgetActuals[number]) => (a.lineType === "expense" || a.lineType === "cogs") && a.expenseDate && new Date(a.expenseDate).getMonth() + 1 === m)
      .reduce((s: number, a: typeof budgetActuals[number]) => s + (a.actualAmount || 0), 0)

    const netPlan = revenuePlan - expensePlan
    const netFact = revenueFact - expenseFact

    monthly.push({
      month: m,
      label: MONTH_NAMES[m - 1],
      revenuePlan,
      revenueFact,
      revenueVariance: revenueFact - revenuePlan,
      revenueVariancePct: revenuePlan > 0 ? Math.round(((revenueFact - revenuePlan) / revenuePlan) * 100) : 0,
      expensePlan,
      expenseFact,
      expenseVariance: expenseFact - expensePlan,
      expenseVariancePct: expensePlan > 0 ? Math.round(((expenseFact - expensePlan) / expensePlan) * 100) : 0,
      netPlan,
      netFact,
    })
  }

  // Totals
  const totalRevenuePlan = monthly.reduce((s, m) => s + m.revenuePlan, 0)
  const totalRevenueFact = monthly.reduce((s, m) => s + m.revenueFact, 0)
  const totalExpensePlan = monthly.reduce((s, m) => s + m.expensePlan, 0)
  const totalExpenseFact = monthly.reduce((s, m) => s + m.expenseFact, 0)

  return NextResponse.json({
    data: {
      year,
      monthly,
      totals: {
        revenuePlan: totalRevenuePlan,
        revenueFact: totalRevenueFact,
        revenueVariance: totalRevenueFact - totalRevenuePlan,
        revenueVariancePct: totalRevenuePlan > 0 ? Math.round(((totalRevenueFact - totalRevenuePlan) / totalRevenuePlan) * 100) : 0,
        expensePlan: totalExpensePlan,
        expenseFact: totalExpenseFact,
        expenseVariance: totalExpenseFact - totalExpensePlan,
        expenseVariancePct: totalExpensePlan > 0 ? Math.round(((totalExpenseFact - totalExpensePlan) / totalExpensePlan) * 100) : 0,
        netPlan: totalRevenuePlan - totalExpensePlan,
        netFact: totalRevenueFact - totalExpenseFact,
      },
    },
  })
}
