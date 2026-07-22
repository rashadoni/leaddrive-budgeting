/**
 * Phase 7.G Turn LXXXXIX (Phase 7.E #2 v2 E.1d terminal-side, server half).
 *
 * GET /api/indicators/values/resolve?company=X&indicator=Y&period=Z
 * GET /api/indicators/values/resolve?companyId=X&indicator=Y&period=Z
 *
 * Resolves either a `(companyCode, indicatorCode, period)` triplet or an
 * explicit `(companyId, indicatorCode, period)` triplet to IndicatorValue.id.
 * AlertEvent links use companyId; ordinary human-readable links use company.
 *
 * Auth: any authenticated org member (read endpoint; same exposure as
 * `/api/indicators` list).
 *
 * Cross-tenant: composite where `(organizationId, ...)` rejects sibling-
 * org reads — 404 instead of leak.
 *
 * Response shapes:
 *   200: { indicatorValueId, companyId, indicatorId }
 *   400: { error: "missing/invalid params" }
 *   404: { error: "no IndicatorValue for this triplet" }
 */

import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { withOrgScope } from "@/lib/db/with-org-scope"

const PERIOD_REGEX = /^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/

const querySchema = z.object({
  company: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  indicator: z.string().min(1),
  period: z.string().regex(PERIOD_REGEX),
}).refine((value) => Boolean(value.company) !== Boolean(value.companyId), {
  message: "Supply exactly one of company or companyId",
  path: ["company"],
})

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const url = new URL(req.url)
  const params = {
    company: url.searchParams.get("company") ?? undefined,
    companyId: url.searchParams.get("companyId") ?? undefined,
    indicator: url.searchParams.get("indicator") ?? "",
    period: url.searchParams.get("period") ?? "",
  }

  let parsed
  try {
    parsed = querySchema.parse(params)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: "Invalid query" }, { status: 400 })
  }

  const orgId = session.orgId

  // Step 1: Resolve the explicit identifier kind under organization scope.
  // Keeping code and id in separate parameters prevents a code/id collision
  // from making findFirst select an arbitrary company.
  const company = await withOrgScope(orgId, (tx) =>
    tx.company.findFirst({
      where: parsed.companyId
        ? { organizationId: orgId, id: parsed.companyId }
        : { organizationId: orgId, code: parsed.company! },
      select: { id: true },
    }),
  )
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  // Phase 7.F sub-group RBAC.
  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(company.id)) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  // Steps 2 + 3 — indicator lookup + IndicatorValue in one org-scoped tx.
  // The indicator_definitions RLS policy explicitly allows organizationId
  // IS NULL, so the global-seed row stays readable under the app role.
  const { indicator, iv } = await withOrgScope(orgId, async (tx) => {
    const indicator = await tx.indicatorDefinition.findFirst({
      where: {
        code: parsed.indicator,
        OR: [{ organizationId: orgId }, { organizationId: null }],
      },
      select: { id: true },
      // Org-specific overrides take priority
      orderBy: { organizationId: { sort: "asc", nulls: "last" } },
    })
    if (!indicator) return { indicator: null, iv: null }
    const iv = await tx.indicatorValue.findUnique({
      where: {
        companyId_indicatorId_period: {
          companyId: company.id,
          indicatorId: indicator.id,
          period: parsed.period,
        },
      },
      select: { id: true },
    })
    return { indicator, iv }
  })
  if (!indicator) {
    return NextResponse.json({ error: "Indicator not found" }, { status: 404 })
  }
  if (!iv) {
    return NextResponse.json(
      { error: "No IndicatorValue for this (company, indicator, period)" },
      { status: 404 },
    )
  }

  return NextResponse.json({
    indicatorValueId: iv.id,
    companyId: company.id,
    indicatorId: indicator.id,
  })
}
