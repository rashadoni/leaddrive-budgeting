/**
 * Phase 7.G Turn LXXXXIX (Phase 7.E #2 v2 E.1d terminal-side, server half).
 *
 * GET /api/indicators/values/resolve?company=X&indicator=Y&period=Z
 *
 * Resolves a `(companyCode, indicatorCode, period)` triplet to its
 * `IndicatorValue.id`. Used by Risk Terminal page to deep-link from
 * `AlertEventsFeed` "? Why?" button → auto-open VarianceExplainerPanel.
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
import { prisma } from "@/lib/prisma"

const PERIOD_REGEX = /^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/

const querySchema = z.object({
  company: z.string().min(1),
  indicator: z.string().min(1),
  period: z.string().regex(PERIOD_REGEX),
})

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const url = new URL(req.url)
  const params = {
    company: url.searchParams.get("company") ?? "",
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

  // Step 1: Resolve company by code (org-scoped)
  const company = await prisma.company.findFirst({
    where: { organizationId: session.orgId, code: parsed.company },
    select: { id: true },
  })
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  // Step 2: Resolve indicator by code (org-specific override OR global seed)
  // Match either: organizationId=session.orgId OR organizationId=null (global)
  const indicator = await prisma.indicatorDefinition.findFirst({
    where: {
      code: parsed.indicator,
      OR: [
        { organizationId: session.orgId },
        { organizationId: null },
      ],
    },
    select: { id: true },
    // Org-specific overrides take priority
    orderBy: { organizationId: { sort: "asc", nulls: "last" } },
  })
  if (!indicator) {
    return NextResponse.json({ error: "Indicator not found" }, { status: 404 })
  }

  // Step 3: Find IndicatorValue
  const iv = await prisma.indicatorValue.findUnique({
    where: {
      companyId_indicatorId_period: {
        companyId: company.id,
        indicatorId: indicator.id,
        period: parsed.period,
      },
    },
    select: { id: true },
  })
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
