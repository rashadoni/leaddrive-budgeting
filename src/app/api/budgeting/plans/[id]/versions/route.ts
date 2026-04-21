import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

// GET — list all versions in the chain for a plan
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: planId } = await params

  // Find the plan to get the root
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  const rootId = (plan as any).amendmentOf || plan.id

  // Find all plans in the version chain
  const versions = await prisma.budgetPlan.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { id: rootId },
        { amendmentOf: rootId },
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      version: true,
      versionLabel: true,
      amendmentOf: true,
      createdAt: true,
      approvedAt: true,
      approvedBy: true,
    },
    orderBy: { version: "asc" },
  })

  return NextResponse.json(versions)
}
