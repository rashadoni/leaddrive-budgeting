import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { resolveCompanyFilter } from "@/lib/budgeting/company-filter"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { resolvePnlEliminationScope } from "@/lib/onboarding/ai-import/pnl-elimination-scope"
import { buildProductMarginsFromAccounts } from "@/lib/budgeting/product-margin-accounts"

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
      planId: string
      deletedAt: null
      companyId?: { in: string[] }
      isElimination?: boolean
    } = { organizationId: orgId, planId, deletedAt: null }
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
        where,
        _sum: { plannedAmount: true },
      }),
      tx.budgetLine.groupBy({ by: ["monthIndex"], where }),
    ])

    const accounts = await tx.chartOfAccount.findMany({
      where: { id: { in: totals.map((t) => t.accountId) } },
      select: { id: true, code: true, name: true },
    })
    const byId = new Map(accounts.map((a) => [a.id, a]))

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
      monthsCovered: months
        .map((m) => m.monthIndex)
        .filter((m): m is number => m != null)
        .map((m) => m + 1)
        .sort((a, b) => a - b),
      basis: elimination.basis,
    })
  })
}
