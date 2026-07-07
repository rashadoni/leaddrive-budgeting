/**
 * Phase 7.H Feature 5 — Client-reported reconciliation reference values.
 *
 * GET    /api/companies/[id]/reconciliation                    (any-member; sub-group-scoped)
 *        ?period=YYYY-MM&indicatorKey=EBITDA                   optional filters
 *
 * POST   /api/companies/[id]/reconciliation                    (manager+)
 *        body: { period, indicatorKey, value, currency?, note? }
 *        → 200/201 + audit event (upsert by companyId × period × indicatorKey)
 *
 * DELETE /api/companies/[id]/reconciliation                    (manager+)
 *        ?reconciliationId=<id>                                → 200 + audit event
 *
 * Auth: manager+ for writes (mirrors `/api/indicator-disclosures` which
 * is the closest analog — manual data the client provided that we want
 * a finance-trail for, not a CFO-level approval gate).
 *
 * Sub-group RBAC: `getCompanyScope` is consulted on every verb so a
 * manager restricted to Tabia can't reconcile EDEN AGRO under
 * Azərşəkər — same pattern as `/api/indicator-disclosures` and the
 * other Phase 7.F sub-group-scoped routes.
 */

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireAuth, requireRole, isAuthError } from "@/lib/api-auth"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import {
  CreateReconciliationSchema,
  ListReconciliationQuerySchema,
  DeleteReconciliationQuerySchema,
} from "./validate"

/* ─────────────────────────── GET ─────────────────────────── */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const { id: companyId } = await params
  const orgId = session.orgId

  // Tenant scope first — 404 (not 403) for cross-tenant to avoid leaking
  // company existence; same pattern as PATCH /api/companies/[id].
  const company = await withOrgScope(orgId, (tx) =>
    tx.company.findFirst({
      where: { id: companyId, organizationId: orgId },
      select: { id: true },
    }),
  )
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  // Sub-group RBAC (getCompanyScope uses prismaAdmin, self-contained).
  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(companyId)) {
    return NextResponse.json({ error: "Access denied to this company" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const parsed = ListReconciliationQuerySchema.safeParse({
    period: searchParams.get("period") ?? undefined,
    indicatorKey: searchParams.get("indicatorKey") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.format() },
      { status: 400 },
    )
  }

  const rows = await withOrgScope(orgId, (tx) =>
    tx.clientReconciliation.findMany({
    where: {
      organizationId: orgId,
      companyId,
      ...(parsed.data.period ? { period: parsed.data.period } : {}),
      ...(parsed.data.indicatorKey ? { indicatorKey: parsed.data.indicatorKey } : {}),
    },
    orderBy: [{ period: "desc" }, { indicatorKey: "asc" }],
    take: 200,
    select: {
      id: true,
      companyId: true,
      period: true,
      indicatorKey: true,
      value: true,
      currency: true,
      note: true,
      submittedById: true,
      submittedAt: true,
      updatedAt: true,
    },
    }),
  )

  return NextResponse.json({ rows })
}

/* ─────────────────────────── POST ─────────────────────────── */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const { id: companyId } = await params
  const orgId = session.orgId

  const company = await withOrgScope(orgId, (tx) =>
    tx.company.findFirst({
      where: { id: companyId, organizationId: orgId },
      select: { id: true },
    }),
  )
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(companyId)) {
    return NextResponse.json({ error: "Access denied to this company" }, { status: 403 })
  }

  let body: z.infer<typeof CreateReconciliationSchema>
  try {
    body = CreateReconciliationSchema.parse(await req.json())
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid body",
        details: err instanceof z.ZodError ? err.format() : String(err),
      },
      { status: 400 },
    )
  }

  // Stage 3 RLS — upsert + awaited audit in one org-scoped tx.
  const { row, auditResult, existing } = await withOrgScope(orgId, async (tx) => {
  // Upsert by composite unique key (companyId × period × indicatorKey).
  const existing = await tx.clientReconciliation.findUnique({
    where: {
      companyId_period_indicatorKey: {
        companyId,
        period: body.period,
        indicatorKey: body.indicatorKey,
      },
    },
    select: { id: true, value: true },
  })

  const row = existing
    ? await tx.clientReconciliation.update({
        where: { id: existing.id },
        data: {
          value: body.value,
          currency: body.currency,
          note: body.note ?? null,
          submittedById: session.userId,
        },
        select: {
          id: true,
          companyId: true,
          period: true,
          indicatorKey: true,
          value: true,
          currency: true,
          note: true,
          submittedById: true,
          submittedAt: true,
          updatedAt: true,
        },
      })
    : await tx.clientReconciliation.create({
        data: {
          organizationId: orgId,
          companyId,
          period: body.period,
          indicatorKey: body.indicatorKey,
          value: body.value,
          currency: body.currency,
          note: body.note ?? null,
          submittedById: session.userId,
        },
        select: {
          id: true,
          companyId: true,
          period: true,
          indicatorKey: true,
          value: true,
          currency: true,
          note: true,
          submittedById: true,
          submittedAt: true,
          updatedAt: true,
        },
      })

  const auditResult = await logAuditEvent(tx, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "client_reconciliation_submit",
      entityType: "ClientReconciliation",
      entityId: row.id,
      metadata: {
        companyId: row.companyId,
        period: row.period,
        indicatorKey: row.indicatorKey,
        clientValue: row.value,
        currency: row.currency,
        noteLength: body.note?.length ?? 0,
        ...(existing ? { previousValue: existing.value } : {}),
      },
    },
    context: buildAuditContext({
      route: "/api/companies/[id]/reconciliation",
      userAgent: req.headers.get("user-agent") ?? undefined,
    }),
  })
    return { row, auditResult, existing }
  })

  return NextResponse.json(
    { row, ...(auditResult.ok ? {} : { auditStale: true }) },
    { status: existing ? 200 : 201 },
  )
}

/* ─────────────────────────── DELETE ─────────────────────────── */

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const { id: companyId } = await params
  const orgId = session.orgId

  const company = await withOrgScope(orgId, (tx) =>
    tx.company.findFirst({
      where: { id: companyId, organizationId: orgId },
      select: { id: true },
    }),
  )
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(companyId)) {
    return NextResponse.json({ error: "Access denied to this company" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const parsed = DeleteReconciliationQuerySchema.safeParse({
    reconciliationId: searchParams.get("reconciliationId") ?? "",
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.format() },
      { status: 400 },
    )
  }

  // Stage 3 RLS — lookup, delete + awaited audit in one org-scoped tx.
  const result = await withOrgScope(orgId, async (tx) => {
    const existing = await tx.clientReconciliation.findFirst({
      where: {
        id: parsed.data.reconciliationId,
        organizationId: orgId,
        companyId,
      },
      select: {
        id: true,
        period: true,
        indicatorKey: true,
        value: true,
        currency: true,
      },
    })
    if (!existing) return { notFound: true as const }

    await tx.clientReconciliation.delete({ where: { id: existing.id } })

    const auditResult = await logAuditEvent(tx, {
      organizationId: orgId,
      actorUserId: session.userId,
      event: {
        action: "client_reconciliation_delete",
        entityType: "ClientReconciliation",
        entityId: existing.id,
        metadata: {
          companyId,
          period: existing.period,
          indicatorKey: existing.indicatorKey,
          deletedValue: existing.value,
          currency: existing.currency,
        },
      },
      context: buildAuditContext({
        route: "/api/companies/[id]/reconciliation",
        userAgent: req.headers.get("user-agent") ?? undefined,
      }),
    })
    return { auditResult }
  })

  if ("notFound" in result) {
    return NextResponse.json({ error: "Reconciliation not found" }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    ...(result.auditResult.ok ? {} : { auditStale: true }),
  })
}
