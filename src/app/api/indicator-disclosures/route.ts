/**
 * Phase 7.H F4.v2.3 — manual ESG-disclosure entry endpoint.
 *
 * Upserts `IndicatorDisclosure` rows that override the v2.1 modeled-
 * generic ESG placeholders. After the row lands, the route triggers a
 * targeted recompute for (company × indicator × year) so the affected
 * IndicatorValue picks up the disclosed value + flips `valueSource`
 * from `modeled_generic` to `disclosed`. The Panel-3 badge auto-
 * switches from gray "ОБЩАЯ ОЦЕНКА" → teal "РАСКРЫТО" on the next
 * matrix fetch.
 *
 * GET   ?companyId=&indicatorCode=&period=   list (any-member)
 * POST  body { companyId, indicatorCode, period, value, unit, sourceNote?, forceConfirm? }
 *       → 200/201 + audit event + recompute trigger (manager+)
 */

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
// Stage 3 RLS — `prisma` kept for the fire-and-forget audit + recompute
// (both must outlive the write tx).
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireAuth, requireRole, isAuthError } from "@/lib/api-auth"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:indicator-disclosures")
import {
  ESG_DISCLOSABLE_INDICATOR_CODES,
  getEsgDisclosureRule,
  validateValue,
} from "@/lib/risk/metric-validation-rules"
import { logAuditEvent } from "@/lib/audit/log"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"
import { getCompanyScope } from "@/lib/rbac/company-scope"

const PERIOD_REGEX = /^\d{4}(-Q[1-4]|-\d{2})?$/

const ListQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  indicatorCode: z.string().min(1).optional(),
  period: z.string().regex(PERIOD_REGEX).optional(),
})

const CreateBodySchema = z.object({
  companyId: z.string().min(1),
  indicatorCode: z.enum(
    ESG_DISCLOSABLE_INDICATOR_CODES as unknown as [string, ...string[]],
  ),
  period: z.string().regex(PERIOD_REGEX, "Invalid period (YYYY | YYYY-QN | YYYY-MM)"),
  value: z.number().finite(),
  unit: z.string().min(1).max(40),
  sourceNote: z.string().max(500).optional(),
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
    indicatorCode: searchParams.get("indicatorCode") ?? undefined,
    period: searchParams.get("period") ?? undefined,
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

  const orgId = session.orgId
  const rows = await withOrgScope(orgId, (tx) =>
    tx.indicatorDisclosure.findMany({
    where: {
      organizationId: orgId,
      ...(parsed.data.companyId ? { companyId: parsed.data.companyId } : {}),
      ...(parsed.data.indicatorCode
        ? { indicatorCode: parsed.data.indicatorCode }
        : {}),
      ...(parsed.data.period ? { period: parsed.data.period } : {}),
      ...(scope.ids != null
        ? { companyId: { in: Array.from(scope.ids) } }
        : {}),
    },
    orderBy: [{ period: "desc" }, { indicatorCode: "asc" }],
    take: 500,
    select: {
      id: true,
      companyId: true,
      indicatorCode: true,
      period: true,
      value: true,
      unit: true,
      sourceNote: true,
      enteredBy: true,
      enteredAt: true,
      updatedAt: true,
    },
    }),
  )

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

  const orgId = session.orgId
  const company = await withOrgScope(orgId, (tx) =>
    tx.company.findFirst({
      where: { id: body.companyId, organizationId: orgId },
      select: { id: true },
    }),
  )
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  const rule = getEsgDisclosureRule(body.indicatorCode)
  if (!rule) {
    return NextResponse.json(
      {
        error: `Indicator "${body.indicatorCode}" is not eligible for disclosure override`,
      },
      { status: 400 },
    )
  }

  // Historical mean — across all disclosure rows for this (co,
  // indicator). 3-row floor mirrors the operational-facts route.
  const history = await withOrgScope(orgId, (tx) =>
    tx.indicatorDisclosure.findMany({
      where: {
        organizationId: orgId,
        companyId: body.companyId,
        indicatorCode: body.indicatorCode,
      },
      orderBy: { period: "desc" },
      take: 12,
      select: { value: true },
    }),
  )
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

  // Stage 3 RLS — upsert in the org-scoped tx; the fire-and-forget audit +
  // recompute below run AFTER on the global client (must outlive the tx).
  const { row, existing } = await withOrgScope(orgId, async (tx) => {
  const existing = await tx.indicatorDisclosure.findUnique({
    where: {
      companyId_indicatorCode_period: {
        companyId: body.companyId,
        indicatorCode: body.indicatorCode,
        period: body.period,
      },
    },
    select: { id: true, value: true },
  })

  const row = existing
    ? await tx.indicatorDisclosure.update({
        where: { id: existing.id },
        data: {
          value: body.value,
          unit: body.unit,
          sourceNote: body.sourceNote ?? null,
          enteredBy: session.userId,
        },
        select: {
          id: true,
          companyId: true,
          indicatorCode: true,
          period: true,
          value: true,
          unit: true,
          sourceNote: true,
          enteredBy: true,
          enteredAt: true,
          updatedAt: true,
        },
      })
    : await tx.indicatorDisclosure.create({
        data: {
          organizationId: orgId,
          companyId: body.companyId,
          indicatorCode: body.indicatorCode,
          period: body.period,
          value: body.value,
          unit: body.unit,
          sourceNote: body.sourceNote ?? null,
          enteredBy: session.userId,
        },
        select: {
          id: true,
          companyId: true,
          indicatorCode: true,
          period: true,
          value: true,
          unit: true,
          sourceNote: true,
          enteredBy: true,
          enteredAt: true,
          updatedAt: true,
        },
      })
    return { row, existing }
  })

  void logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: existing
        ? "indicator_disclosure_update"
        : "indicator_disclosure_create",
      entityType: "IndicatorDisclosure",
      entityId: row.id,
      metadata: {
        companyId: row.companyId,
        indicatorCode: row.indicatorCode,
        period: row.period,
        value: row.value,
        unit: row.unit,
        sourceNote: body.sourceNote,
        ...(existing ? { previousValue: existing.value } : {}),
      },
    },
    context: { route: "/api/indicator-disclosures" },
  }).catch((err) => {
    log.error("audit log failed", {
      err: err instanceof Error ? err.message : String(err),
    })
  })

  // Fire-and-forget targeted recompute so the matrix surface updates
  // without the user having to manually click "Пересчитать". Year is
  // derived from the period prefix (works for "YYYY", "YYYY-QN",
  // "YYYY-MM" — first 4 chars).
  const year = Number(row.period.slice(0, 4))
  if (Number.isFinite(year)) {
    void runRecomputeForCompanies(
      prisma,
      session.orgId,
      [{ companyId: row.companyId, year }],
      {},
      { codeFilter: [row.indicatorCode] },
    ).catch((err) => {
      log.error("post-save recompute failed", {
        companyId: row.companyId,
        year,
        indicatorCode: row.indicatorCode,
        err: err instanceof Error ? err.message : String(err),
      })
    })
  }

  return NextResponse.json({ row }, { status: existing ? 200 : 201 })
}
