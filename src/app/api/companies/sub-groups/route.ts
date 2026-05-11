/**
 * Phase 7.F sub-group RBAC admin v2 — list level-1 (sub-group)
 * companies for the access picker.
 *
 * GET /api/companies/sub-groups — admin only. Returns
 * `[{ id, code, name, childCount }]` for every sub-group in the org.
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

  const subGroups = await prisma.company.findMany({
    where: {
      organizationId: session.orgId,
      parentCompanyId: null,
      isActive: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
      _count: { select: { children: true } },
    },
    orderBy: { sortOrder: "asc" },
  })

  type Row = (typeof subGroups)[number]
  return NextResponse.json({
    subGroups: (subGroups as Row[]).map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      childCount: c._count.children,
    })),
  })
}
