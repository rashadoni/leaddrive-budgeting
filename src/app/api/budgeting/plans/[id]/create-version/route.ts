import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"

// POST — create a new version of an existing plan
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "manager")
  if (session instanceof NextResponse) return session

  const { id: planId } = await params
  const { orgId } = session

  // Find original plan
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    include: { lines: true },
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  // Phase 7.G Turn LXIX architect Round-1 ⚠️ closure — period-lock guard
  // (create-version writes snapshotData on the existing plan AND clones
  // it as a new versioned plan, both into the period container).
  const lock = await getActivePeriodLock(prisma, orgId, derivePeriodKey(plan))
  if (lock) return lockedResponse(lock)

  // Snapshot current plan state
  const snapshot = {
    lines: plan.lines.map((l: any) => ({
      category: l.category,
      department: l.department,
      lineType: l.lineType,
      lineSubtype: l.lineSubtype,
      plannedAmount: l.plannedAmount,
      forecastAmount: l.forecastAmount,
      costModelKey: l.costModelKey,
      isAutoPlanned: l.isAutoPlanned,
      isAutoActual: l.isAutoActual,
      costTypeId: l.costTypeId,
      departmentId: l.departmentId,
      parentId: l.parentId,
      notes: l.notes,
      sortOrder: l.sortOrder,
    })),
  }

  // Save snapshot to current plan
  await prisma.budgetPlan.update({
    where: { id: planId },
    data: { snapshotData: snapshot },
  })

  // Determine root of version chain
  const rootId = (plan as any).amendmentOf || plan.id
  const currentVersion = (plan as any).version || 1

  // Clone plan with incremented version
  const newPlan = await prisma.budgetPlan.create({
    data: {
      organizationId: orgId,
      name: plan.name,
      periodType: plan.periodType,
      year: plan.year,
      month: plan.month,
      quarter: plan.quarter,
      status: "draft",
      notes: plan.notes,
      amendmentOf: rootId,
      version: currentVersion + 1,
      versionLabel: `v${currentVersion + 1}`,
    },
  })

  // Clone all lines
  for (const line of plan.lines) {
    await prisma.budgetLine.create({
      data: {
        organizationId: orgId,
        planId: newPlan.id,
        category: line.category,
        department: line.department,
        lineType: line.lineType,
        lineSubtype: line.lineSubtype,
        plannedAmount: line.plannedAmount,
        forecastAmount: line.forecastAmount,
        costModelKey: line.costModelKey,
        isAutoPlanned: line.isAutoPlanned,
        isAutoActual: line.isAutoActual,
        costTypeId: line.costTypeId,
        departmentId: line.departmentId,
        notes: line.notes,
        sortOrder: line.sortOrder,
        // Phase 7.G Turn XL architect Suggestion: pass through
        // monthIndex on plan-version clone so monthly tagging survives
        // versioning. Without this, a backfilled source row would lose
        // its monthIndex on version-bump and revert to the legacy
        // `sortOrder % 100` resolver path.
        monthIndex: line.monthIndex ?? null,
        // parentId not cloned — hierarchy re-established separately if needed
      },
    })
  }

  return NextResponse.json({ success: true, data: newPlan }, { status: 201 })
}
