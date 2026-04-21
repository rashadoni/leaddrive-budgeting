import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

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
  const { orgId } = session

  const { id } = await params

  const plan = await prisma.budgetPlan.findFirst({
    where: { id, organizationId: orgId, deletedAt: { not: null } },
    select: { id: true },
  })
  if (!plan) {
    return NextResponse.json(
      { error: "Plan not found or not soft-deleted (purge is only for plans already in the Recently Deleted bin)" },
      { status: 404 },
    )
  }

  // Cascade-delete every child row before removing the plan itself.
  // Order matters only where foreign-key constraints would block (e.g. forecast
  // entries reference plan + line). Using $transaction guarantees all-or-none.
  await prisma.$transaction([
    prisma.budgetForecastEntry.deleteMany({ where: { planId: id } }),
    prisma.rollingForecastMonth.deleteMany({ where: { planId: id } }),
    prisma.budgetActual.deleteMany({ where: { planId: id } }),
    prisma.budgetLine.deleteMany({ where: { planId: id } }),
    prisma.salesBudgetLine.deleteMany({ where: { planId: id } }),
    prisma.cOGSBudgetLine.deleteMany({ where: { planId: id } }),
    prisma.cOGSCostDetail.deleteMany({ where: { planId: id } }),
    prisma.balanceSheetLine.deleteMany({ where: { planId: id } }),
    prisma.budgetAssumption.deleteMany({ where: { planId: id } }),
    prisma.budgetApprovalComment.deleteMany({ where: { planId: id } }),
    prisma.savedBudgetReport.deleteMany({ where: { planId: id } }),
    prisma.budgetChangeLog.deleteMany({ where: { planId: id } }),
    prisma.budgetPlan.delete({ where: { id } }),
  ])

  return NextResponse.json({ success: true })
}
