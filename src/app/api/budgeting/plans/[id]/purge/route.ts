import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's 423-audit.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"

/**
 * DELETE /api/budgeting/plans/[id]/purge
 *
 * Physically removes a soft-deleted plan and ALL of its child rows.
 * Must be called on a plan that is already soft-deleted (`deletedAt` set);
 * refuses to touch live plans so accidents during the 30-day grace window
 * can still be caught.
 *
 * Admin-only, same bar as the soft-delete itself.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "admin")
  if (session instanceof NextResponse) return session
  const { orgId, userId } = session

  const { id } = await params

  // Stage 3 RLS — plan guard, lock check and the 13-table cascade delete
  // in one org-scoped tx (the former $transaction([array]) becomes a
  // sequential chain; RLS additionally scopes each deleteMany to the org,
  // hardening the planId-only WHERE clauses).
  return withOrgScope(orgId, async (tx) => {
    const plan = await tx.budgetPlan.findFirst({
      where: { id, organizationId: orgId, deletedAt: { not: null } },
      select: { id: true, periodType: true, year: true, month: true, quarter: true },
    })
    if (!plan) {
      return NextResponse.json(
        { error: "Plan not found or not soft-deleted (purge is only for plans already in the Recently Deleted bin)" },
        { status: 404 },
      )
    }

    // Period-lock gate — purge is the most-destructive budget route.
    const lock = await getActivePeriodLock(tx, orgId, derivePeriodKey(plan))
    if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "DELETE /api/budgeting/plans/[id]/purge" })

    // Cascade-delete every child row before removing the plan itself.
    // Order matters where FK constraints would block; the sequential
    // chain inside one interactive tx keeps it all-or-none.
    await tx.budgetForecastEntry.deleteMany({ where: { planId: id } })
    await tx.rollingForecastMonth.deleteMany({ where: { planId: id } })
    await tx.budgetActual.deleteMany({ where: { planId: id } })
    await tx.budgetLine.deleteMany({ where: { planId: id } })
    await tx.salesBudgetLine.deleteMany({ where: { planId: id } })
    await tx.cOGSBudgetLine.deleteMany({ where: { planId: id } })
    await tx.cOGSCostDetail.deleteMany({ where: { planId: id } })
    await tx.balanceSheetLine.deleteMany({ where: { planId: id } })
    await tx.budgetAssumption.deleteMany({ where: { planId: id } })
    await tx.budgetApprovalComment.deleteMany({ where: { planId: id } })
    await tx.savedBudgetReport.deleteMany({ where: { planId: id } })
    await tx.budgetChangeLog.deleteMany({ where: { planId: id } })
    await tx.budgetPlan.delete({ where: { id } })

    return NextResponse.json({ success: true })
  })
}
