/**
 * Phase 7.N — PATCH /api/companies/[id]/risk-tags
 *
 * Merges `{ riskTags: string[] }` into `Company.settings` without
 * touching industry-specific fields (hectaresPlanted, totalRooms, etc.).
 * Merge is shallow: only the `riskTags` key is updated; the rest of the
 * settings JSON is preserved verbatim.
 *
 * Why not reuse the existing PATCH /api/companies/[id]/settings:
 * The settings endpoint does a wholesale replace validated against a
 * per-industry Zod schema that uses .strict() — adding riskTags to those
 * schemas would require editing all three + the generic fallback, and would
 * still wipe industry fields if the client forgot to re-send them. A
 * separate merge-style endpoint is simpler and safer.
 *
 * Auth: manager+ (risk assessment is a privileged editorial action).
 * Rate-limit: 20/min/org (interactive single-row toggle clicks).
 * Audit: `company_settings_update` reused with metadata.keysChanged=["riskTags"].
 */

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
// Stage 3 RLS — `prisma` kept ONLY for the fire-and-forget audit below.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:companies:risk-tags")
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"

export const RISK_TAGS = [
  "subsidy_dependency",
  "non_transparent_structure",
  "data_absence",
] as const
export type RiskTag = (typeof RISK_TAGS)[number]

const BodySchema = z.object({
  riskTags: z.array(z.enum(RISK_TAGS)).max(RISK_TAGS.length),
})

const RATE_LIMIT = { name: "company-risk-tags", max: 20, windowMs: 60_000 }

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const rateLimitError = enforceRateLimit(
    `${session.orgId}:${getClientIp(req)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  const { id } = await params
  const orgId = session.orgId

  const company = await withOrgScope(orgId, (tx) =>
    tx.company.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, code: true, industry: true, settings: true },
    }),
  )
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(id)) {
    return NextResponse.json({ error: "Access denied to this company" }, { status: 403 })
  }

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await req.json())
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid body", details: err instanceof z.ZodError ? err.format() : String(err) },
      { status: 400 },
    )
  }

  const current = (company.settings as Record<string, unknown> | null) ?? {}
  const updated = { ...current, riskTags: body.riskTags }

  // Stage 3 RLS — merge-update in the org-scoped tx.
  await withOrgScope(orgId, (tx) =>
    tx.company.update({
      where: { id },
      data: { settings: updated },
    }),
  )

  // Audit is fire-and-forget → stays on the global client (outlives any tx).
  void logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "company_settings_update",
      entityType: "Company",
      entityId: id,
      metadata: {
        companyCode: company.code,
        industry: company.industry,
        keysChanged: ["riskTags"],
        before: { riskTags: current.riskTags ?? [] },
        after: { riskTags: body.riskTags },
      },
    },
    context: buildAuditContext({
      route: "/api/companies/[id]/risk-tags",
      userAgent: req.headers.get("user-agent") ?? undefined,
    }),
  }).catch((err) => {
    log.error("audit failed (non-blocking)", {
      err: err instanceof Error ? err.message : String(err),
    })
  })

  return NextResponse.json({ riskTags: body.riskTags })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const { id } = await params
  const orgId = session.orgId
  const company = await withOrgScope(orgId, (tx) =>
    tx.company.findFirst({
      where: { id, organizationId: orgId },
      select: { settings: true },
    }),
  )
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  const settings = (company.settings as Record<string, unknown> | null) ?? {}
  const riskTags = Array.isArray(settings.riskTags)
    ? (settings.riskTags as string[]).filter((t) =>
        (RISK_TAGS as readonly string[]).includes(t),
      )
    : []

  return NextResponse.json({ riskTags })
}
