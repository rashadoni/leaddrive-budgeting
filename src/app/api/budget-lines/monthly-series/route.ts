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

  const rows = await prisma.budgetLine.findMany({
    where: {
      organizationId: orgId,
      companyId,
      plan: { year },
      ...(accountCode
        ? { account: { code: accountCode } }
        : { category: category! }),
      // 12-row-per-line monthly persistence: sortOrder 0..11 = month index.
      sortOrder: { gte: 0, lte: 11 },
    },
    select: {
      sortOrder: true,
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
    const m = r.sortOrder
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
