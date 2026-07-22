import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"

// GET — list all versions in the chain for a plan
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: planId } = await params

  const versions = await withOrgScope(orgId, async (tx) => {
    // Find the plan to get the root
    const plan = await tx.budgetPlan.findFirst({
      where: { id: planId, organizationId: orgId, deletedAt: null },
    })
    if (!plan) return null

    const rootId = plan.amendmentOf || plan.id

    // Find all plans in the version chain
    return tx.budgetPlan.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        OR: [{ id: rootId }, { amendmentOf: rootId }],
      },
      select: {
        id: true,
        name: true,
        status: true,
        version: true,
        versionLabel: true,
        amendmentOf: true,
        kind: true,
        _count: { select: { lines: { where: { deletedAt: null } } } },
        createdAt: true,
        approvedAt: true,
        approvedBy: true,
      },
      orderBy: { version: "asc" },
    })
  })
  if (!versions) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  return NextResponse.json(versions)
}
