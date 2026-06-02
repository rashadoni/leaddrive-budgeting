/**
 * Phase 7.H F4.v2.3 — manual operational-KPI entry endpoint.
 *
 * Today the 13 operational indicators (yield, occupancy, FCR, mortality,
 * etc.) rely on `OperationalFact` rows that exist only via direct-SQL
 * INSERT — no UI path. This route is that UI's backend. Mirrors the
 * shape of `/api/budgeting/period-locks`: org-scoped, manager+ writes,
 * Zod-validated with sanity ranges + anomaly detection.
 *
 * GET   ?companyId=&metric=&from=&to=  → list (any-member read)
 * POST  body { companyId, metric, date, value, unit, sourceNote? }
 *       → 201 create + audit event (manager+)
 *       → 400 on validation, 409 on duplicate (companyId × metric × date)
 *       → 200 with `requiresConfirm: true` + `warnings` when soft-bounds
 *         or anomaly fires AND `forceConfirm` is not set in body
 */

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAuth, requireRole, isAuthError } from "@/lib/api-auth"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:operational-facts")
import {
  OPERATIONAL_METRIC_KEYS,
  getOperationalRule,
  validateValue,
} from "@/lib/risk/metric-validation-rules"
import { logAuditEvent } from "@/lib/audit/log"
import { recomputeAfterDataChange } from "@/lib/recompute/recompute-on-change"
import { getCompanyScope } from "@/lib/rbac/company-scope"

const ListQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  metric: z.string().min(1).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
})

const CreateBodySchema = z.object({
  companyId: z.string().min(1),
  // Restrict to the curated catalog — prevents anonymous metric strings
  // from landing in the table; client must pick from
  // `OPERATIONAL_METRIC_KEYS`. Unknown metric = 400.
  metric: z.enum(OPERATIONAL_METRIC_KEYS as unknown as [string, ...string[]]),
  date: z.string().datetime({ offset: true }),
  value: z.number().finite(),
  unit: z.string().min(1).max(40),
  sourceNote: z.string().max(500).optional(),
  /**
   * When true, soft-bound + anomaly warnings are downgraded to logs
   * and the entry is persisted. UI uses this on the second click of
   * a confirm-required dialog. Hard-bound violations are NEVER
   * downgradeable — out-of-range stays a 400.
   */
  forceConfirm: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const { searchParams } = new URL(req.url)
  const parsed = ListQuerySchema.safeParse({
    companyId: searchParams.get("companyId") ?? undefined,
    metric: searchParams.get("metric") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.format() },
      { status: 400 },
    )
  }

  const scope = await getCompanyScope(
    session.orgId,
    session.userId,
    session.role,
  )

  // Sub-group RBAC: if the user is restricted, force the companyId filter
  // into the allowed set. Unrestricted users (admin) pass through.
  const where = {
    organizationId: session.orgId,
    ...(parsed.data.companyId ? { companyId: parsed.data.companyId } : {}),
    ...(parsed.data.metric ? { metric: parsed.data.metric } : {}),
    ...(parsed.data.from || parsed.data.to
      ? {
          date: {
            ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
            ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {}),
          },
        }
      : {}),
    ...(scope.ids != null ? { companyId: { in: Array.from(scope.ids) } } : {}),
  }

  const rows = await prisma.operationalFact.findMany({
    where,
    orderBy: [{ date: "desc" }, { metric: "asc" }],
    take: 500,
    select: {
      id: true,
      companyId: true,
      metric: true,
      date: true,
      value: true,
      unit: true,
      source: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ rows })
}

export async function POST(req: NextRequest) {
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  let body: z.infer<typeof CreateBodySchema>
  try {
    body = CreateBodySchema.parse(await req.json())
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid body",
        details: err instanceof z.ZodError ? err.format() : String(err),
      },
      { status: 400 },
    )
  }

  // Cross-tenant guard — confirm the company belongs to the caller's org.
  const company = await prisma.company.findFirst({
    where: { id: body.companyId, organizationId: session.orgId },
    select: { id: true },
  })
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  const rule = getOperationalRule(body.metric)
  if (!rule) {
    return NextResponse.json(
      { error: `Unknown metric "${body.metric}"` },
      { status: 400 },
    )
  }

  // Historical mean for anomaly check — last 12 months of the same
  // company + metric. Skipped when the table has < 3 rows (anomaly
  // detection needs a baseline to be useful).
  const history = await prisma.operationalFact.findMany({
    where: { organizationId: session.orgId, companyId: body.companyId, metric: body.metric },
    orderBy: { date: "desc" },
    take: 12,
    select: { value: true },
  })
  const historicalMean =
    history.length >= 3
      ? history.reduce((a: number, r: { value: number }) => a + r.value, 0) /
        history.length
      : undefined

  const result = validateValue(rule, body.value, body.unit, historicalMean)
  if (!result.ok) {
    return NextResponse.json(
      { error: "Validation failed", errors: result.errors },
      { status: 400 },
    )
  }

  // Soft-bound or anomaly warnings → require explicit forceConfirm.
  // First request returns 200 with `requiresConfirm: true` + the
  // warnings text; UI shows the confirm dialog; second request lands
  // with `forceConfirm: true` and persists.
  const requiresConfirm =
    !body.forceConfirm &&
    (result.warnings.length > 0 || result.anomalyWarning != null)
  if (requiresConfirm) {
    return NextResponse.json(
      {
        requiresConfirm: true,
        warnings: result.warnings,
        anomalyWarning: result.anomalyWarning,
      },
      { status: 200 },
    )
  }

  // Upsert by (companyId, metric, date) — calling POST on an existing
  // row updates it rather than throwing P2002. Mirrors the
  // CFO-friendly "edit-in-place" semantic the inline grid expects.
  const existing = await prisma.operationalFact.findFirst({
    where: {
      organizationId: session.orgId,
      companyId: body.companyId,
      metric: body.metric,
      date: new Date(body.date),
    },
    select: { id: true, value: true },
  })

  const row = existing
    ? await prisma.operationalFact.update({
        where: { id: existing.id },
        data: {
          value: body.value,
          unit: body.unit,
          source: body.sourceNote ?? "manual",
        },
        select: {
          id: true,
          companyId: true,
          metric: true,
          date: true,
          value: true,
          unit: true,
          source: true,
        },
      })
    : await prisma.operationalFact.create({
        data: {
          organizationId: session.orgId,
          companyId: body.companyId,
          metric: body.metric,
          date: new Date(body.date),
          value: body.value,
          unit: body.unit,
          source: body.sourceNote ?? "manual",
        },
        select: {
          id: true,
          companyId: true,
          metric: true,
          date: true,
          value: true,
          unit: true,
          source: true,
        },
      })

  // Audit event — fire-and-forget; a failure here must not roll the
  // mutation back. Recorded inputs include companyId + metric + date so
  // a future reviewer can replay against an inactive table.
  void logAuditEvent(prisma, {
    organizationId: session.orgId,
    actorUserId: session.userId,
    event: {
      action: existing ? "operational_fact_update" : "operational_fact_create",
      entityType: "OperationalFact",
      entityId: row.id,
      metadata: {
        companyId: row.companyId,
        metric: row.metric,
        date: row.date.toISOString(),
        value: row.value,
        unit: row.unit ?? undefined,
        sourceNote: body.sourceNote,
        ...(existing ? { previousValue: existing.value } : {}),
      },
    },
    context: { route: "/api/operational-facts" },
  }).catch((err) => {
    log.error("audit log failed", {
      err: err instanceof Error ? err.message : String(err),
    })
  })

  // Recompute the company's indicators so the saved KPI is reflected
  // immediately (best-effort + serverless-safe synchronous — see helper).
  const year = new Date(body.date).getUTCFullYear()
  const recompute = await recomputeAfterDataChange(
    session.orgId,
    body.companyId,
    year,
  )

  return NextResponse.json({ row, recompute }, { status: existing ? 200 : 201 })
}
