/**
 * Phase 7.I — PATCH /api/companies/[id]/settings.
 *
 * Replaces `Company.settings` JSON wholesale with the validated payload.
 * Schema is per-industry (validate.ts dispatches by `company.industry`):
 *   - hospitality       → { totalRooms, seasonalityProfile, region }
 *   - agro_crops        → { hectaresPlanted, region, cropType, yieldTarget }
 *   - food_processing   → { processingCapacityTonsYr, extractionRateTarget, mainInputCommodity }
 *   - generic / unknown → free-form record (capped at 32 keys × 256-char values)
 *
 * Why wholesale-replace vs merge: Settings shape varies per industry; a
 * partial-update API would let stale keys from a previous industry config
 * leak forward when a company changes industry. Client sends the FULL
 * intended settings object on every save — simpler model with predictable
 * end state.
 *
 * Auth: manager+ (mirrors `/api/companies/[id]/reconciliation` since
 * settings drives indicator + LLM context = comparable sensitivity).
 *
 * RBAC: sub-group scope checked the same way as reconciliation — admin
 * can edit any company; manager limited to allowedSubGroupIds tree.
 *
 * Audit: `company_settings_update` with before/after + keysChanged diff.
 * Recompute is NOT triggered here — the next periodic recompute picks up
 * the new settings; an immediate recompute is a follow-up if latency
 * matters to the client.
 */

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { settingsSchemaForIndustry } from "./validate"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // GET is open to viewers — settings are read-only useful for the
  // operational dashboard widgets (hectares display, region badge).
  const session = await requireRole(req, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
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
  // Sub-group scope check (getCompanyScope uses prismaAdmin, self-contained).
  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(id)) {
    return NextResponse.json({ error: "Access denied to this company" }, { status: 403 })
  }

  return NextResponse.json({
    companyId: company.id,
    companyCode: company.code,
    industry: company.industry,
    settings: (company.settings as Record<string, unknown> | null) ?? {},
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const { id } = await params
  const orgId = session.orgId

  const company = await withOrgScope(orgId, (tx) =>
    tx.company.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        code: true,
        industry: true,
        settings: true,
      },
    }),
  )
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  // Sub-group RBAC (getCompanyScope uses prismaAdmin, self-contained).
  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(id)) {
    return NextResponse.json({ error: "Access denied to this company" }, { status: 403 })
  }

  // Parse body — bare object (no envelope) so the client can PATCH the
  // settings directly without wrapping it.
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const schema = settingsSchemaForIndustry(company.industry)
  let validated: Record<string, unknown>
  try {
    validated = schema.parse(rawBody) as Record<string, unknown>
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid settings for industry",
        industry: company.industry,
        details: err instanceof z.ZodError ? err.format() : String(err),
      },
      { status: 400 },
    )
  }

  // Compute diff for audit before persisting. Audit before/after are
  // capped to keep the row size sane; production audit reviewer can fetch
  // full state from the Company row if needed.
  const previous = (company.settings as Record<string, unknown> | null) ?? null
  const keysChanged = computeKeysChanged(previous, validated)

  // Stage 3 RLS — wholesale-replace + awaited audit in one org-scoped tx.
  const auditResult = await withOrgScope(orgId, async (tx) => {
    await tx.company.update({
      where: { id: company.id },
      data: { settings: validated as never },
    })
    return logAuditEvent(tx, {
      organizationId: orgId,
      actorUserId: session.userId,
      event: {
        action: "company_settings_update",
        entityType: "Company",
        entityId: company.id,
        metadata: {
          companyCode: company.code,
          industry: company.industry,
          keysChanged,
          before: previous,
          after: validated,
        },
      },
      context: buildAuditContext({
        route: "/api/companies/[id]/settings",
        userAgent: req.headers.get("user-agent") ?? undefined,
      }),
    })
  })

  return NextResponse.json({
    companyId: company.id,
    companyCode: company.code,
    industry: company.industry,
    settings: validated,
    keysChanged,
    ...(auditResult.ok ? {} : { auditStale: true }),
  })
}

/**
 * Compute the set of keys that differ between `before` and `after`.
 * Considers: added (in after but not before), removed (in before but not
 * after), and modified (in both with different JSON-serialized value).
 *
 * Returned array is sorted for stable audit diff output. Pure helper —
 * exported for unit-test coverage.
 */
export function computeKeysChanged(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  const bk = before ? new Set(Object.keys(before)) : new Set<string>()
  const ak = new Set(Object.keys(after))
  const changed = new Set<string>()
  for (const k of ak) {
    if (!bk.has(k)) {
      changed.add(k) // added
      continue
    }
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after[k])) {
      changed.add(k) // modified
    }
  }
  for (const k of bk) {
    if (!ak.has(k)) changed.add(k) // removed
  }
  return [...changed].sort()
}
