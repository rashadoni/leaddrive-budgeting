/**
 * Phase 7.D — IndicatorValue drill-down GET endpoint.
 *
 * Used by Panel 3 (IndicatorDetail) to render formula + resolved vars +
 * aggregates + threshold hint when a HeatMap cell is clicked. The matrix
 * response keeps cells lean (id + status + value); detail fetches the
 * full indicator-definition + persisted inputs only on demand.
 *
 * Auth: any authenticated user with org-scoped read access. 404 on
 * cross-tenant id (no existence-leak).
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { getCompanyScope } from "@/lib/rbac/company-scope"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const { id } = await params
  if (typeof id !== "string" || id.trim() === "") {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const iv = await prisma.indicatorValue.findFirst({
    where: { id, organizationId: session.orgId },
    select: {
      id: true,
      value: true,
      status: true,
      period: true,
      computedAt: true,
      inputs: true,
      sparkline: true,
      companyId: true,
      indicator: {
        select: {
          id: true,
          code: true,
          nameEn: true,
          nameAz: true,
          nameRu: true,
          unit: true,
          direction: true,
          formula: true,
          thresholds: true,
          hintTemplateEn: true,
          hintTemplateAz: true,
          hintTemplateRu: true,
          requiredInputs: true,
        },
      },
      company: {
        select: { id: true, code: true, name: true, industry: true },
      },
    },
  })
  if (!iv) {
    return NextResponse.json(
      { error: "Indicator value not found" },
      { status: 404 },
    )
  }

  // Phase 7.F sub-group RBAC.
  const scope = await getCompanyScope(session.orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(iv.companyId)) {
    return NextResponse.json({ error: "Indicator value not found" }, { status: 404 })
  }

  return NextResponse.json({
    id: iv.id,
    value: iv.value,
    status: iv.status,
    period: iv.period,
    computedAt: iv.computedAt.toISOString(),
    inputs: iv.inputs,
    sparkline: iv.sparkline,
    indicator: iv.indicator,
    company: iv.company,
  })
}
