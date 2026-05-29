/**
 * Phase 7.H F4.v2.3 — single-row operational-fact mutation endpoint.
 *
 * DELETE /api/operational-facts/[id] — admin only; emits
 * `operational_fact_delete` audit event. Editing is handled via
 * `POST /api/operational-facts` upsert path (companyId × metric × date
 * is the natural key, not the row id).
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { logAuditEvent } from "@/lib/audit/log"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:operational-facts:id")

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  const existing = await prisma.operationalFact.findFirst({
    where: { id, organizationId: session.orgId },
    select: {
      id: true,
      companyId: true,
      metric: true,
      date: true,
      value: true,
      unit: true,
    },
  })
  if (!existing) {
    // 404 not 200 — silent "already-deleted" hides bugs.
    return NextResponse.json(
      { error: "Operational fact not found" },
      { status: 404 },
    )
  }

  await prisma.operationalFact.delete({ where: { id: existing.id } })

  void logAuditEvent(prisma, {
    organizationId: session.orgId,
    actorUserId: session.userId,
    event: {
      action: "operational_fact_delete",
      entityType: "OperationalFact",
      entityId: existing.id,
      metadata: {
        companyId: existing.companyId,
        metric: existing.metric,
        date: existing.date.toISOString(),
        previousValue: existing.value,
        unit: existing.unit ?? undefined,
      },
    },
    context: { route: `/api/operational-facts/${id}` },
  }).catch((err) => {
    log.error("audit log failed", {
      factId: id,
      err: err instanceof Error ? err.message : String(err),
    })
  })

  return NextResponse.json({ ok: true })
}
