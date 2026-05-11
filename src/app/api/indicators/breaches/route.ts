/**
 * Phase 7.G Turn LXXXXIX (Phase 7.E #3 v2 E.2d server half).
 *
 * GET /api/indicators/breaches?period=YYYY[-Q1..4|-MM]&minConfidenceBand=low|medium|high
 *
 * Returns predictive breach forecasts for the org. Backed by E.2b
 * `getPredictiveBreaches` (Prisma `PredictiveBreach` table or in-memory
 * fallback when migration not yet applied).
 *
 * Auth: any authenticated org member (read endpoint; same exposure as
 * `/api/indicators` list).
 *
 * Cross-tenant: enforced inside `getPredictiveBreaches` via orgId scope —
 * no orgId = empty result.
 *
 * Response shapes:
 *   200: { breaches: ForecastedBreach[], filter: {period?, minConfidenceBand?} }
 *   400: { error: "Validation failed", details }
 *   401: { error: "Unauthorized" }
 *   403: { error: "User has no organization" }
 */

import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { getPredictiveBreaches } from "@/lib/risk/breach-persist"

const PERIOD_REGEX = /^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/

const querySchema = z
  .object({
    period: z.string().regex(PERIOD_REGEX).optional(),
    minConfidenceBand: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict()

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const url = new URL(req.url)
  // Pass all query keys to Zod so .strict() rejects unknowns. Drop empty-
  // string values so optional regex fields aren't tripped (Zod treats "" as
  // a present-but-invalid string for the regex).
  const rawParams: Record<string, string> = {}
  for (const [k, v] of url.searchParams.entries()) {
    if (v !== "") rawParams[k] = v
  }

  let parsed
  try {
    parsed = querySchema.parse(rawParams)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: "Invalid query" }, { status: 400 })
  }

  const breaches = await getPredictiveBreaches(session.orgId, {
    period: parsed.period,
    minConfidenceBand: parsed.minConfidenceBand,
  })

  // Phase 7.F sub-group RBAC — filter breaches by allowed companies.
  const scope = await getCompanyScope(session.orgId, session.userId, session.role)
  const scoped = scope.ids != null
    ? breaches.filter((b) => scope.ids!.has(b.companyId))
    : breaches

  // Strip organizationId from response — caller already knows their own org.
  const sanitized = scoped.map(({ organizationId: _o, ...rest }) => rest)

  return NextResponse.json({
    breaches: sanitized,
    filter: {
      period: parsed.period ?? null,
      minConfidenceBand: parsed.minConfidenceBand ?? null,
    },
    count: sanitized.length,
  })
}
