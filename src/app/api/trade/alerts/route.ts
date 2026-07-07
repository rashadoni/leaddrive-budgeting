/**
 * Trade alert inbox — `GET /api/trade/alerts` (Phase 9.8).
 * Open (unresolved) trade-domain alerts + the 20 most recent resolved.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"

const ALERT_SELECT = {
  id: true,
  severity: true,
  title: true,
  message: true,
  messageKey: true,
  messageParams: true,
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

  // Stage 3 RLS — reads run in the org-scoped tx (sequential: an
  // interactive tx serializes queries on one connection anyway).
  const { open, resolved } = await withOrgScope(orgId, async (tx) => {
    const open = await tx.alert.findMany({
      where: { organizationId: orgId, domain: "trade", resolvedAt: null },
      orderBy: [{ severity: "asc" }, { triggeredAt: "desc" }],
      take: 100,
      select: ALERT_SELECT,
    })
    const resolved = await tx.alert.findMany({
      where: { organizationId: orgId, domain: "trade", resolvedAt: { not: null } },
      orderBy: { resolvedAt: "desc" },
      take: 20,
      select: ALERT_SELECT,
    })
    return { open, resolved }
  })

  return NextResponse.json({ ok: true, open, resolved })
}
