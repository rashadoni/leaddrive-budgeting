/**
 * Phase 7.F admin v3 — generate a new temp password for a user.
 *
 * PATCH /api/users/[id]/password-reset (no body)
 * Admin-only. Returns the new temp password ONCE; admin shows it to
 * the user out-of-band (Slack/email/in-person). User should change
 * it on next login.
 */

import { NextRequest, NextResponse } from "next/server"
// Stage 3 RLS — `prisma` kept for the awaited audit write.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import bcrypt from "bcryptjs"
import { randomBytes } from "crypto"

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

  const target = await withOrgScope(orgId, (tx) =>
    tx.user.findFirst({
      where: { id: targetUserId, organizationId: orgId },
      select: { id: true, email: true },
    }),
  )
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  // bcrypt.hash is CPU-bound (~100ms) — run it OUTSIDE the tx so the scope
  // tx isn't held open during hashing.
  const tempPassword = randomBytes(9).toString("base64url")
  const passwordHash = await bcrypt.hash(tempPassword, 10)
  await withOrgScope(orgId, (tx) =>
    tx.user.update({
      where: { id: targetUserId },
      data: { passwordHash },
    }),
  )

  await logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "user_password_reset",
      entityType: "User",
      entityId: targetUserId,
      metadata: { targetEmail: target.email },
    },
    context: buildAuditContext({
      route: "/api/users/[id]/password-reset",
      userAgent: request.headers.get("user-agent") ?? undefined,
    }),
  })

  return NextResponse.json({ ok: true, tempPassword })
}
