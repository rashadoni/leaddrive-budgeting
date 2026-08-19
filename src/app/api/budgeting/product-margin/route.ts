import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { resolveCompanyFilter } from "@/lib/budgeting/company-filter"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { resolvePnlEliminationScope } from "@/lib/onboarding/ai-import/pnl-elimination-scope"
import { buildProductMarginsFromAccounts } from "@/lib/budgeting/product-margin-accounts"
import { buildMarginComparison } from "@/lib/budgeting/product-margin-compare"

/**
 * GET /api/budgeting/product-margin
 *
 * Gross margin per product, read off the P&L chart (2026-08-19). Flat envelope
 * `{success: true, ...payload}`, matching the sibling `/pnl` route rather than
 * the wrapped `{success, data}` of `/analytics` — see the envelope note in
 * `pnl/route.ts`; convergence is deliberately not scheduled.
 *
 * ## Why the scoping is copied from `/pnl` rather than simplified
 *
 * This screen and the P&L page read the same accounts over the same plan, so
 * any difference in company filter, RBAC narrowing or elimination basis shows
 * up as two screens disagreeing about the same product — and the reader has no
 * way to tell which one is lying. The company filter, the sub-group RBAC
 * narrowing and `resolvePnlEliminationScope` below are therefore the same
 * decisions in the same order, and `basis` is returned so the surface can
 * disclose which one it got.
 *
 * ## One plan, not a comparison
 *
 * Deliberately reports a single plan. The client's actuals stop in May while
 * the budget runs the full year, so a budget-vs-actual margin table would put
 * twelve months of budget beside five months of actuals and call the gap
 * performance. The P&L page solves that with an explicit like-for-like month
 * window; this route sidesteps it by answering the question that was actually
 * asked — what margin does each product earn — and stating which months the
 * answer covers.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const orgId = session.orgId

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  // Auth-adjacent and resolved through prismaAdmin, so it belongs OUTSIDE the
  // org-scoped tx rather than lexically inside it.
  const scope = await getCompanyScope(orgId, session.userId, session.role)

  return withOrgScope(orgId, async (tx) => {
    const plan = await tx.budgetPlan.findFirst({
      where: { id: planId, organizationId: orgId, deletedAt: null },
      select: { id: true, name: true, year: true, kind: true },
    })
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

    /**
     * The other half of the comparison. Same year, opposite kind — the same
     * pairing `/pnl` uses, so the two screens cannot disagree about which
     * budget belongs to which actual.
     */
    const counterpartKind =
      plan.kind === "actual" ? "budget" : plan.kind === "budget" ? "actual" : null
    const counterpartPlan = counterpartKind
      ? await tx.budgetPlan.findFirst({
          where: { organizationId: orgId, year: plan.year, kind: counterpartKind, deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, year: true, kind: true },
        })
      : null

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
          products: [],
          comparison: null,
          knownRevenue: 0,
          knownCost: 0,
          knownMarginPct: null,
          revenueWithoutCost: 0,
          contraRevenue: 0,
          contraRevenueAccounts: [],
          unpairedCostAccounts: [],
          monthsCovered: [],
          basis: elimination.basis,
          _emptyReason: "subgroup_no_children",
        })
      }
      where.companyId = { in: companyFilter.companyIds }
    }

    // Per-account totals, not per-line: this screen never shows a month, so
    // aggregating in the database keeps a plan's tens of thousands of rows out
    // of the request entirely.
    const [totals, months] = await Promise.all([
      tx.budgetLine.groupBy({
        by: ["accountId"],
        where: { ...where, planId },
        _sum: { plannedAmount: true },
      }),
      tx.budgetLine.groupBy({ by: ["monthIndex"], where: { ...where, planId } }),
    ])

    const accounts = await tx.chartOfAccount.findMany({
      where: { id: { in: totals.map((t) => t.accountId) } },
      select: { id: true, code: true, name: true },
    })
    const byId = new Map(accounts.map((a) => [a.id, a]))

/**
     * Budget against actual, on the months the ACTUAL side actually carries.
     *
     * The client's actuals stop in May while the budget runs the full year.
     * Comparing them whole would set five months of delivery against twelve
     * months of plan and call the difference performance — every product wrong
     * in the same direction, which is the kind of wrong nobody catches by eye.
     * So the window comes from the actual plan, whichever plan was requested,
     * and both sides are cut to it.
     */
    const actualPlan = plan.kind === "actual" ? plan : counterpartPlan
    const budgetPlan = plan.kind === "budget" ? plan : counterpartPlan
    async function buildComparison() {
      if (!actualPlan || !budgetPlan) return null
      const actualMonths = (
        await tx.budgetLine.groupBy({
          by: ["monthIndex"],
          where: { ...where, planId: actualPlan.id },
        })
      )
        .map((m) => m.monthIndex)
        .filter((m): m is number => m != null)
      if (actualMonths.length === 0) return null

      const window = { in: actualMonths }
      const [budgetTotals, actualTotals] = await Promise.all([
        tx.budgetLine.groupBy({
          by: ["accountId"],
          where: { ...where, planId: budgetPlan.id, monthIndex: window },
          _sum: { plannedAmount: true },
        }),
        tx.budgetLine.groupBy({
          by: ["accountId"],
          where: { ...where, planId: actualPlan.id, monthIndex: window },
          _sum: { plannedAmount: true },
        }),
      ])
      const ids = [...new Set([...budgetTotals, ...actualTotals].map((t) => t.accountId))]
      const cmpAccounts = await tx.chartOfAccount.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true, name: true },
      })
      const cmpById = new Map(cmpAccounts.map((a) => [a.id, a]))
      const rowsOf = (totals: typeof budgetTotals) =>
        totals.flatMap((t) => {
          const account = cmpById.get(t.accountId)
          if (!account?.code) return []
          return [{ code: account.code, name: account.name, amount: t._sum.plannedAmount ?? 0 }]
        })

      return {
        ...buildMarginComparison(rowsOf(budgetTotals), rowsOf(actualTotals)),
        budgetPlan,
        actualPlan,
        // 1-based, converted once — `monthIndex` is stored 0-based.
        monthsCompared: [...actualMonths].sort((a, b) => a - b).map((m) => m + 1),
      }
    }
    const comparison = await buildComparison()

    const result = buildProductMarginsFromAccounts(
      totals.flatMap((t) => {
        const account = byId.get(t.accountId)
        if (!account?.code) return []
        return [{ code: account.code, name: account.name, amount: t._sum.plannedAmount ?? 0 }]
      }),
    )

    return NextResponse.json({
      success: true,
      plan,
      ...result,
      /**
       * 1-based calendar months. `BudgetLine.monthIndex` is stored 0-BASED —
       * converted here, once, because every place that has re-derived it has
       * eventually got it wrong by one and reported January–May as
       * February–June.
       */
      comparison,
      monthsCovered: months
        .map((m) => m.monthIndex)
        .filter((m): m is number => m != null)
        .map((m) => m + 1)
        .sort((a, b) => a - b),
      basis: elimination.basis,
    })
  })
}
