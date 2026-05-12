/**
 * Phase 7.H F4.v2.3 — single-row disclosure mutation endpoint.
 *
 * DELETE /api/indicator-disclosures/[id] — admin only. Removes the
 * manual override; the next recompute on this (company, indicator,
 * period) triple will fall back to the modeled-generic formula and
 * the Panel-3 badge flips back to gray "ОБЩАЯ ОЦЕНКА".
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { logAuditEvent } from "@/lib/audit/log"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"

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

  const existing = await prisma.indicatorDisclosure.findFirst({
    where: { id, organizationId: session.orgId },
    select: {
      id: true,
      companyId: true,
      indicatorCode: true,
      period: true,
      value: true,
      unit: true,
    },
  })
  if (!existing) {
    return NextResponse.json(
      { error: "Indicator disclosure not found" },
      { status: 404 },
    )
  }

  await prisma.indicatorDisclosure.delete({ where: { id: existing.id } })

  void logAuditEvent(prisma, {
    organizationId: session.orgId,
    actorUserId: session.userId,
    event: {
      action: "indicator_disclosure_delete",
      entityType: "IndicatorDisclosure",
      entityId: existing.id,
      metadata: {
        companyId: existing.companyId,
        indicatorCode: existing.indicatorCode,
        period: existing.period,
        previousValue: existing.value,
        unit: existing.unit,
      },
    },
    context: { route: `/api/indicator-disclosures/${id}` },
  }).catch((err) => {
    console.error("[indicator-disclosures] audit log failed:", err)
  })

  // Targeted recompute so the IndicatorValue falls back to the modeled
  // formula and the badge flips back to gray "ОБЩАЯ ОЦЕНКА".
  const year = Number(existing.period.slice(0, 4))
  if (Number.isFinite(year)) {
    void runRecomputeForCompanies(
      prisma,
      session.orgId,
      [{ companyId: existing.companyId, year }],
      {},
      { codeFilter: [existing.indicatorCode] },
    ).catch((err) => {
      console.error(
        "[indicator-disclosures] post-delete recompute failed:",
        err,
      )
    })
  }

  return NextResponse.json({ ok: true })
}
