import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"

/**
 * Lightweight per-org tab-availability probe used by the sidebar to hide
 * empty data-domain tabs (Bug #6 demo-blocker fix). For each domain table
 * the endpoint returns a boolean: TRUE if the org has at least 1 row.
 *
 * Tabs with `false` get hidden client-side from the budget sub-nav. The
 * underlying URL still works (`?tab=sales-budget` etc.), so direct
 * navigation by users / external links / saved bookmarks isn't broken —
 * the tab just doesn't appear in the visible nav for orgs that haven't
 * imported that data domain yet.
 *
 * Tabs that handle their own empty state (Plans, Comparison, Forecast,
 * Configuration, Import) always return `true`.
 */
export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Stage 3 RLS — the presence probe runs in one org-scoped tx. Queries
  // are issued sequentially (an interactive tx serializes on one
  // connection; the prior Promise.all parallelism doesn't apply).
  const [
    budgetLines,
    budgetRevenueLines,
    budgetCogsLines,
    salesBudget,
    cogsBudget,
    balanceSheet,
    cashFlow,
    assumptions,
    salesForecast,
    expenseForecast,
    rolling,
  ] = await withOrgScope(orgId, async (tx) => {
    // deletedAt:null on the 3 soft-delete tables (BudgetLine, BalanceSheetLine,
    // CashFlowEntry) so the tab-availability presence check reflects LIVE rows,
    // not archived ones (2026-05-31). The other tables have no soft-delete column.
    return [
      await tx.budgetLine.count({ where: { organizationId: orgId, deletedAt: null } }),
      await tx.budgetLine.count({ where: { organizationId: orgId, lineType: "revenue", deletedAt: null } }),
      await tx.budgetLine.count({ where: { organizationId: orgId, lineType: "cogs", deletedAt: null } }),
      await tx.salesBudgetLine.count({ where: { organizationId: orgId } }),
      await tx.cOGSBudgetLine.count({ where: { organizationId: orgId } }),
      await tx.balanceSheetLine.count({ where: { organizationId: orgId, deletedAt: null } }),
      await tx.cashFlowEntry.count({ where: { organizationId: orgId, deletedAt: null } }),
      await tx.budgetAssumption.count({ where: { organizationId: orgId } }),
      await tx.salesForecast.count({ where: { organizationId: orgId } }),
      await tx.expenseForecast.count({ where: { organizationId: orgId } }),
      await tx.rollingForecastMonth.count({ where: { organizationId: orgId } }),
    ] as const
  })

  return NextResponse.json(
    {
      "pnl-report": budgetLines > 0,
      "sales-budget": salesBudget > 0 || budgetRevenueLines > 0,
      cogs: cogsBudget > 0 || budgetCogsLines > 0,
      "balance-sheet": balanceSheet > 0,
      "cash-flow": cashFlow > 0,
      assumptions: assumptions > 0,
      workspace: budgetLines > 0,
      pl: budgetLines > 0,
      forecast: budgetLines > 0,
      comparison: true,
      plans: true,
      "sales-forecast": salesForecast > 0,
      "expense-forecast": expenseForecast > 0,
      rolling: rolling > 0,
      "report-builder": budgetLines > 0,
      integrations: true,
      config: true,
    },
    {
      // Turn 32: 30s private cache. Sidebar mounts on every page navigation;
      // without this header each mount triggered 9 parallel prisma.count
      // queries (architect Round-1 ⚠️). 30s TTL means table changes (e.g.
      // first BudgetLine import for a domain) take up to 30s to surface in
      // the nav — acceptable since the URL still works direct.
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    },
  )
}
