/**
 * Phase 7.L — GET /api/terminal/impact-forecasts/[companyCode]
 *
 * Returns the N most-recent FeedImpactForecast rows for one company,
 * scoped to caller's organization. Used by `CompanyImpactForecastsCard`
 * in Risk Terminal Panel 4.
 *
 * Auth: viewer role (read-only). Org-scope enforced by the helper.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { getCompanyImpactForecasts } from "@/lib/server/get-company-impact-forecasts"

export const maxDuration = 5

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ companyCode: string }> },
) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const { companyCode } = await params
  if (!companyCode || typeof companyCode !== "string") {
    return NextResponse.json({ error: "companyCode required" }, { status: 400 })
  }

  const limitRaw = new URL(request.url).searchParams.get("limit")
  const limit = limitRaw ? Math.max(1, Math.min(20, parseInt(limitRaw, 10))) : 3

  try {
    const rows = await getCompanyImpactForecasts(
      prisma,
      session.orgId,
      companyCode,
      limit,
    )
    return NextResponse.json({ forecasts: rows })
  } catch (err) {
    console.error("[impact-forecasts GET] failed:", err)
    return NextResponse.json(
      { error: "Failed to fetch impact forecasts" },
      { status: 500 },
    )
  }
}
