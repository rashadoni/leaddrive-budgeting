/**
 * Phase 7.F sub-group RBAC admin v2 — per-user access update.
 *
 * PATCH /api/users/[id]/access — body { allowedSubGroupIds: string[] }
 * Admin-only. Validates that every supplied id is a level-1 (sub-group)
 * Company in the caller's org — rejects unknown / cross-tenant IDs and
 * leaf operational companies (level-2) so the contract stays clean.
 *
 * Empty array clears the restriction (full org access). Non-empty
 * narrows visibility to those sub-groups + their children.
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

  let body: { allowedSubGroupIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (
    !Array.isArray(body.allowedSubGroupIds) ||
    !body.allowedSubGroupIds.every((s) => typeof s === "string" && s.length > 0)
  ) {
    return NextResponse.json(
      { error: "allowedSubGroupIds must be a string[] (empty array clears scope)" },
      { status: 400 },
    )
  }
  const incomingIds = body.allowedSubGroupIds as string[]

  // Verify target user belongs to caller's org. 404 mirrors cross-tenant
  // pattern used elsewhere — never confirm existence.
  const target = await withOrgScope(orgId, (tx) =>
    tx.user.findFirst({
      where: { id: targetUserId, organizationId: orgId },
      select: { id: true, email: true, allowedSubGroupIds: true },
    }),
  )
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  // Validate each id is a sub-group (level=1) in the same org. Rejects
  // unknown IDs, cross-tenant IDs, and leaf operational rows.
  if (incomingIds.length > 0) {
    const valid = await withOrgScope(orgId, (tx) =>
      tx.company.findMany({
        where: {
          organizationId: orgId,
          id: { in: incomingIds },
          parentCompanyId: null,
        },
        select: { id: true },
      }),
    )
    type Row = (typeof valid)[number]
    const validSet = new Set((valid as Row[]).map((c) => c.id))
    const invalid = incomingIds.filter((id) => !validSet.has(id))
    if (invalid.length > 0) {
      return NextResponse.json(
        {
          error: `Invalid sub-group IDs (must be level-1 Company in same org): ${invalid.join(", ")}`,
        },
        { status: 400 },
      )
    }
  }

  await withOrgScope(orgId, (tx) =>
    tx.user.update({
      where: { id: targetUserId },
      data: { allowedSubGroupIds: incomingIds },
    }),
  )

  await logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "user_access_change",
      entityType: "User",
      entityId: targetUserId,
      metadata: {
        targetEmail: target.email,
        before: target.allowedSubGroupIds,
        after: incomingIds,
      },
    },
    context: buildAuditContext({
      route: "/api/users/[id]/access",
      userAgent: request.headers.get("user-agent") ?? undefined,
    }),
  })

  return NextResponse.json({ ok: true, allowedSubGroupIds: incomingIds })
}
