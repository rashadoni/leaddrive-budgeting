/**
 * Phase 7.G CXLVI — honest status counts from DB.
 *
 * GET /api/indicators/status-summary?period=YYYY[-MM]
 *
 * Returns total counts of IndicatorValue rows by status for the period,
 * grouping by raw DB state (no admin/rollup filtering applied). Used by
 * the HeatMap header badge so the displayed `OG / 5A / 9R / 102?` numbers
 * reflect what's ACTUALLY in the database — not a filtered matrix view
 * that drops admin entities (e.g. ATL-MRKZ cost centre with legitimate
 * red indicators that the matrix view hides).
 *
 * Distinct from `/api/indicators/matrix` which serves the renderable
 * grid (excludes admin to prevent "fake red" admin alarms in HeatMap).
 *
 * Response:
 *   { period, green, amber, red, unknown, total }
 */

import { NextRequest, NextResponse } from "next/server"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { currentBakuYear, parsePeriod, PeriodParseError } from "@/lib/risk/periods"

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  const { orgId } = session
  if (!orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const periodParam = req.nextUrl.searchParams.get("period") ?? currentBakuYear()
  try {
    parsePeriod(periodParam)
  } catch (e) {
    if (e instanceof PeriodParseError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    throw e
  }

  const counts = await withOrgScope(orgId, (tx) =>
    tx.indicatorValue.groupBy({
      by: ["status"],
      where: { organizationId: orgId, period: periodParam },
      _count: { _all: true },
    }),
  )

  const summary = { period: periodParam, green: 0, amber: 0, red: 0, unknown: 0, total: 0 }
  for (const c of counts) {
    const s = c.status as keyof typeof summary
    if (s === "green" || s === "amber" || s === "red" || s === "unknown") {
      summary[s] = c._count._all
      summary.total += c._count._all
    }
  }

  return NextResponse.json(summary)
}
