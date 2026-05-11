/**
 * Phase 7.F sub-group RBAC admin v2 — user list endpoint.
 *
 * GET /api/users — list users in the caller's org with their current
 * RBAC scope (allowedSubGroupIds). Admin-only.
 *
 * Used by the /budgeting/admin/users page to render the access-control
 * table.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "admin")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const users = await prisma.user.findMany({
    where: { organizationId: session.orgId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLogin: true,
      allowedSubGroupIds: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  })

  return NextResponse.json({ users })
}
