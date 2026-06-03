/**
 * Tier 3 drill-down — GET endpoint.
 *
 * URL param `:id` = `IndicatorValue.id`. Returns the BudgetLine rows
 * that fed the indicator's formula for the same (companyId, period)
 * the resolver consumed, plus per-accountType summary totals.
 *
 * Used by Panel 3 (IndicatorDetail) — when the user clicks a HeatMap
 * cell, they can expand a "Источники" section to see the underlying
 * lines instead of just the aggregated `resolved` numbers.
 *
 * Auth: `viewer` role + caller's org must match the IV row's
 * organizationId (404 on mismatch — never leak existence).
 *
 * Note: only `budgetLine`-sourced indicators get meaningful results.
 * Indicators driven by Booking / OperationalFact return an empty
 * lines[] (the caller can hide the section). Adding source coverage
 * for those is a follow-up.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { parsePeriod } from "@/lib/risk/periods"
import { getCompanyScope } from "@/lib/rbac/company-scope"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  const { id: ivId } = await params
  if (typeof ivId !== "string" || ivId.trim() === "") {
    return NextResponse.json({ error: "Invalid indicator-value id" }, { status: 400 })
  }

  // Org-scoped fetch. 404 on either missing OR cross-tenant.
  const iv = await prisma.indicatorValue.findFirst({
    where: { id: ivId, organizationId: orgId },
    select: {
      id: true,
      value: true,
      status: true,
      period: true,
      inputs: true,
      companyId: true,
      indicator: {
        select: {
          code: true,
          nameEn: true,
          nameRu: true,
          nameAz: true,
          unit: true,
          direction: true,
          formula: true,
        },
      },
      company: {
        select: {
          code: true,
          name: true,
        },
      },
    },
  })
  if (!iv) {
    return NextResponse.json({ error: "Indicator value not found" }, { status: 404 })
  }

  // Phase 7.F sub-group RBAC — deny if the IV's company is outside
  // the caller's scope. Same 404 as cross-tenant; never leak existence.
  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(iv.companyId)) {
    return NextResponse.json({ error: "Indicator value not found" }, { status: 404 })
  }

  // Parse the IV period to derive year + month/quarter scope. Mirrors
  // `listBudgetLines` in `src/lib/risk/recompute.ts` so drill-down rows
  // match exactly the rows the resolver consumed.
  let period
  try {
    period = parsePeriod(iv.period)
  } catch {
    return NextResponse.json(
      { error: `Invalid period on IndicatorValue: ${iv.period}` },
      { status: 500 },
    )
  }

  // Prefer the canonical `monthIndex`; fall back to legacy `sortOrder`
  // only when monthIndex is null (mirrors recompute-data-source + the
  // analytics/pnl readers — see the 2026-05-30 month-bucketing fix).
  let monthRange: { gte: number; lte: number } | undefined
  if (period.kind === "month") {
    const m = period.start.getUTCMonth()
    monthRange = { gte: m, lte: m }
  } else if (period.kind === "quarter") {
    const startMonth = period.start.getUTCMonth()
    monthRange = { gte: startMonth, lte: startMonth + 2 }
  }

  const rows = await prisma.budgetLine.findMany({
    where: {
      organizationId: orgId,
      companyId: iv.companyId,
      // Mirror the recompute resolver's plan predicate exactly
      // (recompute-data-source.ts: `plan: { year, kind: "actual" }`). The
      // drilldown explains a REALIZED indicator value, which the terminal P&L
      // computes from ACTUAL plans only; without `kind: "actual"` a forward
      // budget plan (kind="budget", now created by the Y3 actuals/budget split)
      // would sum into the drilldown total and diverge from the value it
      // explains. No-op for orgs that still only have actual plans.
      plan: { year: period.year, kind: "actual" },
      deletedAt: null,
      ...(monthRange
        ? {
            OR: [
              { monthIndex: monthRange },
              { monthIndex: null, sortOrder: monthRange },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      department: true,
      lineType: true,
      plannedAmount: true,
      currencyCode: true,
      exchangeRate: true,
      sortOrder: true,
      monthIndex: true,
      notes: true,
      account: {
        select: {
          code: true,
          name: true,
          nameEn: true,
          accountType: true,
        },
      },
    },
    orderBy: [{ plannedAmount: "desc" }],
    // Cap at 500 lines so a deeply itemized company doesn't blow up
    // the response. The UI also paginates client-side.
    take: 500,
  })

  // Compute summary by accountType (the dimension the resolver cares
  // about: revenue / cogs / expense). Mirrors the resolver's grouping
  // so users can reconcile "opex=4.3M" in panel 3 with the same total
  // here.
  const baseCcy = "AZN"
  const summary: Record<string, { count: number; total: number }> = {}
  type Row = (typeof rows)[number]
  const enriched = rows.map((r: Row) => {
    const accountType = r.account?.accountType ?? r.lineType ?? "unknown"
    const isForeign = r.currencyCode != null && r.currencyCode !== baseCcy
    const rate = r.exchangeRate ?? 1
    const amountBase = isForeign ? r.plannedAmount * rate : r.plannedAmount
    if (!summary[accountType]) summary[accountType] = { count: 0, total: 0 }
    summary[accountType].count += 1
    summary[accountType].total += amountBase
    return {
      id: r.id,
      accountCode: r.account?.code ?? null,
      accountName: r.account?.nameEn ?? r.account?.name ?? null,
      accountType,
      // Phase 2.1 dropped BudgetLine.category (→ accountId FK). Selecting the
      // dropped column was the 500 here — Postgres "column does not exist",
      // only surfaced by a real drill-down (mocked tests returned category).
      // Keep a `category` field for UI back-compat, now = the CoA code.
      category: r.account?.code ?? null,
      department: r.department,
      plannedAmount: r.plannedAmount,
      amountBase,
      currencyCode: r.currencyCode ?? baseCcy,
      exchangeRate: r.exchangeRate ?? null,
      monthIndex:
        r.monthIndex ??
        (r.sortOrder >= 0 && r.sortOrder <= 11 ? r.sortOrder : null),
      notes: r.notes ?? null,
    }
  })

  return NextResponse.json({
    indicatorValueId: iv.id,
    companyId: iv.companyId,
    company: iv.company,
    indicator: iv.indicator,
    period: iv.period,
    year: period.year,
    value: iv.value,
    status: iv.status,
    resolved: (iv.inputs as Record<string, unknown> | null)?.resolved ?? {},
    lines: enriched,
    summary,
    truncated: rows.length === 500,
  })
}
