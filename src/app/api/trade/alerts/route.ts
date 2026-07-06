/**
 * Trade alert inbox — `GET /api/trade/alerts` (Phase 9.8).
 * Open (unresolved) trade-domain alerts + the 20 most recent resolved.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const ALERT_SELECT = {
  id: true,
  severity: true,
  title: true,
  message: true,
  sourceRef: true,
  triggeredAt: true,
  acknowledgedAt: true,
  resolvedAt: true,
} as const

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  const [open, resolved] = await Promise.all([
    prisma.alert.findMany({
      where: { organizationId: orgId, domain: "trade", resolvedAt: null },
      orderBy: [{ severity: "asc" }, { triggeredAt: "desc" }],
      take: 100,
      select: ALERT_SELECT,
    }),
    prisma.alert.findMany({
      where: { organizationId: orgId, domain: "trade", resolvedAt: { not: null } },
      orderBy: { resolvedAt: "desc" },
      take: 20,
      select: ALERT_SELECT,
    }),
  ])

  return NextResponse.json({ ok: true, open, resolved })
}
