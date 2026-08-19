import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { resolveCompanyFilter } from "@/lib/budgeting/company-filter"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { resolvePnlEliminationScope } from "@/lib/onboarding/ai-import/pnl-elimination-scope"
import {
  pnlSectionFromCode,
  revenueContribution,
  otherOperatingContribution,
} from "@/lib/budgeting/coa-role"
import { isDaCode } from "@/lib/budgeting/da-codes"
import { computeEbitda } from "@/lib/budgeting/ebitda"
import { sectionTotalsFromRows, type ClassifiableRow } from "@/lib/budgeting/pnl-section-totals"
import { computeIndirectCashFlow } from "@/lib/budgeting/cash-flow-indirect"

/**
 * GET /api/budgeting/cash-flow/indirect
 *
 * A SUB-route: /api/budgeting/cash-flow already serves the direct statement
 * built from cash_flow_entries, which this client has none of.
 *
 * Indirect cash flow over the window the balance sheet actually moved across.
 *
 * Aggregated here rather than assembled on the client from other endpoints'
 * payloads. That is the lesson of the year-end screen, which read budget costs
 * from a place in the P&L payload where they do not live and reported an
 * EBITDA gap six million wide until someone opened it.
 */

/**
 * Depreciation and amortisation in the client's PLF chart. These sit UNDER
 * `PLF.09`, below EBITDA, so the section classifier files them as
 * below-EBITDA and `isDaCode` — which knows the legacy 703-11 / 721-11 codes —
 * never sees them. Naming the prefix explicitly is the honest fix; inferring
 * "anything called depreciation" from account names would break on the first
 * translated chart.
 */
const PLF_DA_PREFIX = "PLF.09.03."

export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = session.orgId

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const scope = await getCompanyScope(orgId, session.userId, session.role)

  return withOrgScope(orgId, async (tx) => {
    const plan = await tx.budgetPlan.findFirst({
      where: { id: planId, organizationId: orgId, deletedAt: null },
      select: { id: true, name: true, year: true, kind: true },
    })
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

    // A cash flow is a statement about what happened, so it is always read off
    // the actuals — the budget plan carries no balance sheet on this client.
    const actualPlan =
      plan.kind === "actual"
        ? plan
        : await tx.budgetPlan.findFirst({
            where: { organizationId: orgId, year: plan.year, kind: "actual", deletedAt: null },
            orderBy: { createdAt: "asc" },
            select: { id: true, name: true, year: true, kind: true },
          })
    if (!actualPlan) {
      return NextResponse.json({ success: true, plan, statement: null, _reason: "no_actual_plan" })
    }

    const companyFilter = await resolveCompanyFilter(tx, orgId, searchParams.get("companyId"))
    if (companyFilter.kind === "not_found") {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }
    if (scope.ids != null && companyFilter.kind === "single") {
      const filtered = companyFilter.companyIds.filter((id) => scope.ids!.has(id))
      if (filtered.length === 0) {
        return NextResponse.json({ error: "Company not found" }, { status: 404 })
      }
      companyFilter.companyIds = filtered
    }

    const elimination = resolvePnlEliminationScope({
      filterKind: companyFilter.kind === "single" ? "single" : "all",
      restricted: scope.ids != null,
    })

    const where: {
      organizationId: string
      deletedAt: null
      companyId?: { in: string[] }
      isElimination?: boolean
    } = { organizationId: orgId, deletedAt: null }
    if (companyFilter.kind === "all" && scope.ids != null) {
      where.companyId = { in: Array.from(scope.ids) }
    }
    if (!elimination.includeEliminations) where.isElimination = false
    if (companyFilter.kind === "single") {
      if (companyFilter.companyIds.length === 0) {
        return NextResponse.json({ success: true, plan, statement: null, _reason: "subgroup_no_children" })
      }
      where.companyId = { in: companyFilter.companyIds }
    }

    const bsWhere = { ...where, planId: actualPlan.id }
    const months = (
      await tx.balanceSheetLine.groupBy({ by: ["month"], where: bsWhere })
    )
      .map((m) => m.month)
      .filter((m): m is number => m != null)
      .sort((a, b) => a - b)
    if (months.length < 2) {
      return NextResponse.json({ success: true, plan, statement: null, _reason: "not_enough_months" })
    }
    const openingMonth = months[0]
    const closingMonth = months[months.length - 1]

    const balanceAt = async (month: number) => {
      const grouped = await tx.balanceSheetLine.groupBy({
        by: ["accountId"],
        where: { ...bsWhere, month },
        _sum: { amount: true },
      })
      const accounts = await tx.chartOfAccount.findMany({
        where: { id: { in: [...new Set(grouped.map((g) => g.accountId))] } },
        select: { id: true, code: true, name: true },
      })
      const byId = new Map(accounts.map((a) => [a.id, a]))
      return grouped.flatMap((g) => {
        const a = byId.get(g.accountId)
        if (!a?.code) return []
        return [{ code: a.code, name: a.name, amount: g._sum.amount ?? 0 }]
      })
    }

    /**
     * The P&L window is the months the balance moved ACROSS, not the months it
     * was measured at: a balance at the end of January against one at the end
     * of May spans February to May. `monthIndex` is 0-based, `month` is
     * 1-based, so the two conversions meet here and nowhere else.
     */
    const flowMonthIndexes = Array.from(
      { length: closingMonth - openingMonth },
      (_, i) => openingMonth + i,
    )

    const plRows = await (async (): Promise<ClassifiableRow[]> => {
      const grouped = await tx.budgetLine.groupBy({
        by: ["accountId"],
        where: { ...where, planId: actualPlan.id, monthIndex: { in: flowMonthIndexes } },
        _sum: { plannedAmount: true },
      })
      const accounts = await tx.chartOfAccount.findMany({
        where: { id: { in: [...new Set(grouped.map((g) => g.accountId))] } },
        select: { id: true, code: true, accountType: true },
      })
      const byId = new Map(accounts.map((a) => [a.id, a]))
      return grouped.flatMap((g) => {
        const a = byId.get(g.accountId)
        if (!a?.code) return []
        return [{ code: a.code, accountType: a.accountType, month: 1, amount: g._sum.plannedAmount ?? 0 }]
      })
    })()

    const [opening, closing] = await Promise.all([balanceAt(openingMonth), balanceAt(closingMonth)])

    const totals = sectionTotalsFromRows(plRows, [1], {
      section: (code, accountType) => pnlSectionFromCode(code, accountType),
      revenue: revenueContribution,
      otherOperating: otherOperatingContribution,
      isDa: isDaCode,
    })
    const depreciation = plRows
      .filter((r) => r.code.toUpperCase().startsWith(PLF_DA_PREFIX))
      .reduce((s, r) => s + r.amount, 0)

    const statement = computeIndirectCashFlow({
      opening,
      closing,
      depreciation,
      pnlResult: computeEbitda(totals).netProfit,
    })

    return NextResponse.json({
      success: true,
      plan,
      actualPlan,
      statement,
      openingMonth,
      closingMonth,
      basis: elimination.basis,
    })
  })
}
