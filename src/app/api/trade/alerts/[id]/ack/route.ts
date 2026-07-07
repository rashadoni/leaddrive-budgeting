/**
 * Acknowledge a trade alert — `POST /api/trade/alerts/[id]/ack` (Phase 9.8).
 * Ack is a "seen it" stamp; it does not resolve the alert (the evaluator
 * resolves when the condition clears).
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const { id } = await params
  const orgId = session.orgId

  // Stage 3 RLS — write runs in the org-scoped tx.
  const updated = await withOrgScope(orgId, (tx) =>
    tx.alert.updateMany({
      where: { id, organizationId: orgId, domain: "trade", acknowledgedAt: null },
      data: { acknowledgedAt: new Date(), acknowledgedBy: session.userId },
    }),
  )
  if (updated.count === 0) {
    return NextResponse.json(
      { ok: false, error: "Alert not found or already acknowledged" },
      { status: 404 },
    )
  }
  return NextResponse.json({ ok: true })
}
