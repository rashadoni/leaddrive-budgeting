/**
 * Tier 3 drill-down polish — 12-month series for a single account.
 *
 * Used when the user clicks a row in IndicatorDetail's drill-down
 * section. Returns a flat 12-entry array (one per month index 0..11)
 * of plannedAmount aggregated for that (companyId, accountCode, year).
 *
 * Account-matching priority:
 *   1. `accountCode` (joined ChartOfAccount.code) — preferred when the
 *      line was imported with a CoA link
 *   2. `category` string fallback — for legacy or non-CoA imports
 *      (e.g. AAC umbrella BS)
 *
 * Auth: viewer role + org-scoped (404 on cross-tenant).
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { getCompanyScope } from "@/lib/rbac/company-scope"

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  const url = new URL(request.url)
  const companyId = url.searchParams.get("companyId")
  const accountCode = url.searchParams.get("accountCode")
  const category = url.searchParams.get("category")
  const yearStr = url.searchParams.get("year")

  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 })
  }
  if (!accountCode && !category) {
    return NextResponse.json(
      { error: "accountCode or category required" },
      { status: 400 },
    )
  }
  const year = yearStr ? parseInt(yearStr, 10) : null
  if (year == null || !Number.isFinite(year)) {
    return NextResponse.json({ error: "year required" }, { status: 400 })
  }

  // Phase 7.F sub-group RBAC — deny if companyId is outside scope.
  // Same 404 as cross-tenant; never leak existence.
  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(companyId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const rows = await prisma.budgetLine.findMany({
    where: {
      organizationId: orgId,
      companyId,
      plan: { year },
      deletedAt: null,
      ...(accountCode
        ? { account: { code: accountCode } }
        // Phase 2.1 dropped BudgetLine.category (→ accountId FK). The legacy
        // `category` param is now an account CODE — resolve via the CoA FK,
        // not the dropped column (which 500'd "column does not exist").
        : { account: { code: category! } }),
      // Month rows only. Prefer the canonical `monthIndex`; fall back to
      // legacy `sortOrder` when monthIndex is null (mirrors the 2026-05-30
      // month-bucketing fix). A row qualifies when its effective month is
      // in [0,11].
      OR: [
        { monthIndex: { gte: 0, lte: 11 } },
        { monthIndex: null, sortOrder: { gte: 0, lte: 11 } },
      ],
    },
    select: {
      sortOrder: true,
      monthIndex: true,
      plannedAmount: true,
      currencyCode: true,
      exchangeRate: true,
    },
  })

  // Bucket by month. There can be >1 line per month (e.g. multiple
  // department entries under the same CoA account) — sum them.
  const baseCcy = "AZN"
  type MonthEntry = {
    monthIndex: number
    amountBase: number
    lineCount: number
  }
  const months: MonthEntry[] = Array.from({ length: 12 }, (_, i) => ({
    monthIndex: i,
    amountBase: 0,
    lineCount: 0,
  }))
  type Row = (typeof rows)[number]
  for (const r of rows as Row[]) {
    const m = r.monthIndex ?? r.sortOrder
    if (m < 0 || m > 11) continue
    const isForeign = r.currencyCode != null && r.currencyCode !== baseCcy
    const rate = r.exchangeRate ?? 1
    const amountBase = isForeign ? r.plannedAmount * rate : r.plannedAmount
    months[m].amountBase += amountBase
    months[m].lineCount += 1
  }

  return NextResponse.json({
    companyId,
    accountCode: accountCode ?? null,
    category: category ?? null,
    year,
    months,
    totalLines: rows.length,
  })
}
