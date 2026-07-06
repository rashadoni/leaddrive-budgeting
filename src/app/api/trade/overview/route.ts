/**
 * Trade module overview — `GET /api/trade/overview` (Phase 9.2).
 *
 * Master-data counts + spend-type dictionary + recent import batches for
 * the /budgeting/trade page. Read-only; viewer role.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId
  const live = { organizationId: orgId, deletedAt: null } as const

  const [regions, channels, reps, outlets, skus, spendTypes, batches] = await Promise.all([
    prisma.tradeRegion.count({ where: live }),
    prisma.tradeChannel.count({ where: live }),
    prisma.tradeSalesRep.count({ where: live }),
    prisma.tradeOutlet.count({ where: live }),
    prisma.tradeSku.count({ where: live }),
    prisma.tradeSpendType.findMany({
      where: { organizationId: orgId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, key: true, label: true, accrualMethod: true, isActive: true },
    }),
    prisma.tradeImportBatch.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        kind: true,
        sourceFile: true,
        status: true,
        rowCount: true,
        totals: true,
        createdAt: true,
        appliedAt: true,
      },
    }),
  ])

  return NextResponse.json({
    ok: true,
    counts: { regions, channels, reps, outlets, skus, spendTypes: spendTypes.length },
    spendTypes,
    batches,
  })
}
