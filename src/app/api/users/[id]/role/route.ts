/**
 * Phase 7.F admin v2 — change a user's role.
 *
 * PATCH /api/users/[id]/role — body { role: "admin" | "manager" | "editor" | "viewer" }
 *
 * Admin-only. Hard guards prevent the org from being orphaned:
 *  - Self-demotion blocked (you can't strip your own admin)
 *  - Last-admin demotion blocked (would brick org administration)
 *
 * Cross-tenant target → 404 (same response as missing). Audit-logged.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"

const ALLOWED_ROLES = ["admin", "manager", "editor", "viewer"] as const
type AllowedRole = (typeof ALLOWED_ROLES)[number]

function isAllowedRole(s: unknown): s is AllowedRole {
  return typeof s === "string" && (ALLOWED_ROLES as readonly string[]).includes(s)
}

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

  let body: { role?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!isAllowedRole(body.role)) {
    return NextResponse.json(
      {
        error: `role must be one of: ${ALLOWED_ROLES.join(", ")}`,
      },
      { status: 400 },
    )
  }
  const newRole: AllowedRole = body.role

  const target = await prisma.user.findFirst({
    where: { id: targetUserId, organizationId: orgId },
    select: { id: true, email: true, role: true },
  })
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  // Idempotent: no-op if role unchanged.
  if (target.role === newRole) {
    return NextResponse.json({ ok: true, role: newRole, unchanged: true })
  }

  // Self-demotion guard: an admin can't strip their own admin in this
  // call. They have to ask another admin. Prevents accidental lockout.
  if (
    targetUserId === session.userId &&
    target.role === "admin" &&
    newRole !== "admin"
  ) {
    return NextResponse.json(
      {
        error: "You cannot demote yourself from admin. Ask another admin.",
        code: "SELF_DEMOTION_BLOCKED",
      },
      { status: 400 },
    )
  }

  // Last-admin guard: if demoting an admin, ensure at least one other
  // active admin remains. Otherwise the org loses admin control.
  if (target.role === "admin" && newRole !== "admin") {
    const otherAdmins = await prisma.user.count({
      where: {
        organizationId: orgId,
        role: "admin",
        isActive: true,
        id: { not: targetUserId },
      },
    })
    if (otherAdmins === 0) {
      return NextResponse.json(
        {
          error:
            "Cannot demote the last admin. Promote another user to admin first.",
          code: "LAST_ADMIN_BLOCKED",
        },
        { status: 400 },
      )
    }
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: { role: newRole },
  })

  await logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "user_role_change",
      entityType: "User",
      entityId: targetUserId,
      metadata: {
        targetEmail: target.email,
        from: target.role,
        to: newRole,
      },
    },
    context: buildAuditContext({
      route: "/api/users/[id]/role",
      userAgent: request.headers.get("user-agent") ?? undefined,
    }),
  })

  return NextResponse.json({ ok: true, role: newRole })
}
