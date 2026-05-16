import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"

/**
 * POST /api/budgeting/plans/[id]/restore
 *
 * Un-delete a soft-deleted plan by clearing `deletedAt`. All child rows
 * were preserved on delete, so the plan comes back fully intact.
 *
 * Only admins can restore (same bar as the admin-only DELETE).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "admin")
  if (session instanceof NextResponse) return session
  const { orgId, userId } = session

  const { id } = await params

  // Phase L8 finish — period-lock gate. Restoring a deleted plan brings
  // its locked-period BudgetLines back into view; reject 423 to force
  // an explicit unlock+restore workflow.
  const planForLock = await prisma.budgetPlan.findFirst({
    where: { id, organizationId: orgId, deletedAt: { not: null } },
    select: { id: true, periodType: true, year: true, month: true, quarter: true },
  })
  if (planForLock) {
    const lock = await getActivePeriodLock(prisma, orgId, derivePeriodKey(planForLock))
    if (lock)
      return lockedResponse(lock, {
        prisma,
        orgId,
        userId,
        route: "POST /api/budgeting/plans/[id]/restore",
      })
  }

  const result = await prisma.budgetPlan.updateMany({
    where: { id, organizationId: orgId, deletedAt: { not: null } },
    data: { deletedAt: null, deletedBy: null },
  })

  if (result.count === 0) {
    return NextResponse.json(
      { error: "Plan not found or not deleted" },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true })
}
