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
import {
  getMateriality,
  getMaterialityNote,
  isMaterialityScoped,
} from "@/lib/risk/esg-materiality"

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
      // Phase 7.H F4.v2.1 — surface provenance + reserved confidence
      // slot so the panel-3 badge renders without a second request.
      valueSource: true,
      confidence: true,
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

  // Phase 7.H F4.v2.4 — materiality lookup. Only ESG indicators
  // participate; non-ESG cells return null + null note. UI suppresses
  // the badge on null.
  const materiality =
    iv.indicator?.code && isMaterialityScoped(iv.indicator.code)
      ? getMateriality(iv.company.industry, iv.indicator.code)
      : null
  const materialityNote =
    iv.indicator?.code && isMaterialityScoped(iv.indicator.code)
      ? getMaterialityNote(iv.company.industry, iv.indicator.code)
      : null

  return NextResponse.json({
    id: iv.id,
    value: iv.value,
    status: iv.status,
    period: iv.period,
    computedAt: iv.computedAt.toISOString(),
    inputs: iv.inputs,
    sparkline: iv.sparkline,
    // Phase 7.H F4.v2.1 — drives the provenance badge in Panel 3.
    valueSource: iv.valueSource,
    confidence: iv.confidence,
    // Phase 7.H F4.v2.4 — materiality rating + calibration note for
    // the Panel-3 materiality badge tooltip.
    materiality,
    materialityNote,
    indicator: iv.indicator,
    company: iv.company,
  })
}
