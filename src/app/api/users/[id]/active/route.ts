/**
 * Phase 7.F admin v3 — toggle user active state.
 *
 * PATCH /api/users/[id]/active — body { isActive: boolean }
 * Admin-only. Guards mirror the role-change route:
 *   - Self-deactivation blocked (you can't disable your own account)
 *   - Last-active-admin deactivation blocked (would brick org admin)
 */

import { NextRequest, NextResponse } from "next/server"
// Stage 3 RLS — `prisma` kept for the awaited audit write.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  const { id: targetUserId } = await params
  if (typeof targetUserId !== "string" || targetUserId.trim() === "") {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 })
  }

  let body: { isActive?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json(
      { error: "isActive (boolean) required" },
      { status: 400 },
    )
  }
  const newActive = body.isActive

  const target = await withOrgScope(orgId, (tx) =>
    tx.user.findFirst({
      where: { id: targetUserId, organizationId: orgId },
      select: { id: true, email: true, role: true, isActive: true },
    }),
  )
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }
  if (target.isActive === newActive) {
    return NextResponse.json({ ok: true, isActive: newActive, unchanged: true })
  }

  // Self-deactivation guard.
  if (targetUserId === session.userId && newActive === false) {
    return NextResponse.json(
      {
        error: "You cannot deactivate yourself. Ask another admin.",
        code: "SELF_DEACTIVATION_BLOCKED",
      },
      { status: 400 },
    )
  }

  // Last-active-admin guard.
  if (target.role === "admin" && newActive === false) {
    const otherActiveAdmins = await withOrgScope(orgId, (tx) =>
      tx.user.count({
        where: {
          organizationId: orgId,
          role: "admin",
          isActive: true,
          id: { not: targetUserId },
        },
      }),
    )
    if (otherActiveAdmins === 0) {
      return NextResponse.json(
        {
          error:
            "Cannot deactivate the last active admin. Activate another admin first.",
          code: "LAST_ADMIN_BLOCKED",
        },
        { status: 400 },
      )
    }
  }

  await withOrgScope(orgId, (tx) =>
    tx.user.update({
      where: { id: targetUserId },
      data: { isActive: newActive },
    }),
  )

  await logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "user_active_toggle",
      entityType: "User",
      entityId: targetUserId,
      metadata: {
        targetEmail: target.email,
        from: target.isActive,
        to: newActive,
      },
    },
    context: buildAuditContext({
      route: "/api/users/[id]/active",
      userAgent: request.headers.get("user-agent") ?? undefined,
    }),
  })

  return NextResponse.json({ ok: true, isActive: newActive })
}
