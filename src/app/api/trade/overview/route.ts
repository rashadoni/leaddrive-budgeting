/**
 * Trade module overview — `GET /api/trade/overview` (Phase 9.2).
 *
 * Master-data counts + spend-type dictionary + recent import batches for
 * the /budgeting/trade page. Read-only; viewer role.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId
  const live = { organizationId: orgId, deletedAt: null } as const

  // Stage 3 RLS — all reads in one org-scoped tx (sequential by design).
  const [regions, channelRows, reps, outlets, skus, spendTypes, batches] = await withOrgScope(
    orgId,
    async (tx) => {
      const regions = await tx.tradeRegion.count({ where: live })
      const channelRows = await tx.tradeChannel.findMany({
        where: { ...live, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, channelType: true },
      })
      const reps = await tx.tradeSalesRep.count({ where: live })
      const outlets = await tx.tradeOutlet.count({ where: live })
      const skus = await tx.tradeSku.count({ where: live })
      const spendTypes = await tx.tradeSpendType.findMany({
        where: { organizationId: orgId },
        orderBy: { sortOrder: "asc" },
        select: { id: true, key: true, label: true, accrualMethod: true, isActive: true },
      })
      const batches = await tx.tradeImportBatch.findMany({
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
      })
      return [regions, channelRows, reps, outlets, skus, spendTypes, batches] as const
    },
  )

  return NextResponse.json({
    ok: true,
    counts: { regions, channels: channelRows.length, reps, outlets, skus, spendTypes: spendTypes.length },
    spendTypes,
    channels: channelRows,
    batches,
  })
}
