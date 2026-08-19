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
import { projectYearEnd } from "@/lib/budgeting/year-end-landing"
import { sectionTotalsFromRows, type ClassifiableRow } from "@/lib/budgeting/pnl-section-totals"

/**
 * GET /api/budgeting/year-end
 *
 * Where the year lands: actual to date, plan for the rest.
 *
 * ## Why this aggregates rows instead of reading the P&L payload
 *
 * The first cut of this screen composed the landing client-side from
 * `/api/budgeting/pnl`. That payload carries budget REVENUE and COGS at the
 * top level but not budget opex, D&A or below-EBITDA — those live under
 * `comparison.budget`. Reading them from the top level yielded zero, so budget
 * costs vanished, EBITDA came out inflated, and the screen reported a −5.7M
 * EBITDA gap where the P&L showed +888k for the same months. Two screens
 * disagreeing about one number, which is the exact failure this codebase keeps
 * being bitten by.
 *
 * Classifying the rows here removes the payload shape from the equation. The
 * classifier is `pnlSectionFromCode` and the composition is `computeEbitda` —
 * the same two the P&L uses — so the agreement is structural rather than
 * maintained by hand.
 */
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

    const counterpartKind =
      plan.kind === "actual" ? "budget" : plan.kind === "budget" ? "actual" : null
    const counterpart = counterpartKind
      ? await tx.budgetPlan.findFirst({
          where: { organizationId: orgId, year: plan.year, kind: counterpartKind, deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, year: true, kind: true },
        })
      : null

    const actualPlan = plan.kind === "actual" ? plan : counterpart
    const budgetPlan = plan.kind === "budget" ? plan : counterpart

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
        return NextResponse.json({
          success: true,
          plan,
          landing: null,
          basis: elimination.basis,
          _emptyReason: "subgroup_no_children",
        })
      }
      where.companyId = { in: companyFilter.companyIds }
    }

    if (!actualPlan || !budgetPlan) {
      return NextResponse.json({ success: true, plan, landing: null, basis: elimination.basis })
    }

    const rowsFor = async (id: string): Promise<ClassifiableRow[]> => {
      const grouped = await tx.budgetLine.groupBy({
        by: ["accountId", "monthIndex"],
        where: { ...where, planId: id },
        _sum: { plannedAmount: true },
      })
      const accounts = await tx.chartOfAccount.findMany({
        where: { id: { in: [...new Set(grouped.map((g) => g.accountId))] } },
        select: { id: true, code: true, accountType: true },
      })
      const byId = new Map(accounts.map((a) => [a.id, a]))
      return grouped.flatMap((g) => {
        const account = byId.get(g.accountId)
        if (!account?.code || g.monthIndex == null) return []
        return [
          {
            code: account.code,
            accountType: account.accountType,
            // Stored 0-based; every window below is expressed 1-based, the way
            // a reader means "January is 1".
            month: g.monthIndex + 1,
            amount: g._sum.plannedAmount ?? 0,
          },
        ]
      })
    }

    const [actualRows, budgetRows] = await Promise.all([
      rowsFor(actualPlan.id),
      rowsFor(budgetPlan.id),
    ])

    const monthsActual = [...new Set(actualRows.filter((r) => r.amount !== 0).map((r) => r.month))].sort(
      (a, b) => a - b,
    )
    if (monthsActual.length === 0) {
      return NextResponse.json({ success: true, plan, landing: null, basis: elimination.basis })
    }
    const monthsRemaining = Array.from({ length: 12 }, (_, i) => i + 1).filter(
      (m) => !monthsActual.includes(m),
    )

    const classify = {
      section: (code: string, accountType: string | null) => pnlSectionFromCode(code, accountType),
      revenue: revenueContribution,
      otherOperating: otherOperatingContribution,
      isDa: isDaCode,
    }

    const landing = projectYearEnd({
      actualToDate: sectionTotalsFromRows(actualRows, monthsActual, classify),
      budgetToDate: sectionTotalsFromRows(budgetRows, monthsActual, classify),
      budgetRemaining: sectionTotalsFromRows(budgetRows, monthsRemaining, classify),
      monthsActual,
      monthsRemaining,
    })

    return NextResponse.json({
      success: true,
      plan,
      actualPlan,
      budgetPlan,
      landing,
      basis: elimination.basis,
    })
  })
}
