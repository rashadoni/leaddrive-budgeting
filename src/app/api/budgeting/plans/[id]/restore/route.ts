import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

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
  const { orgId } = session

  const { id } = await params

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
