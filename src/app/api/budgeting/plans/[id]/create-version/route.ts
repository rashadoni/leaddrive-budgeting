import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { requireRole } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's 423-audit.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"

// Phase 8 D3(z) (2026-05-28) — typed shape for the BudgetPlan + lines
// include used by this route. Replaces the 3 `(plan as any)` /
// `(l: any)` casts that were undoing the type safety Prisma provides
// (amendmentOf + version are columns on BudgetPlan — no schema gap,
// the casts were stale).
type PlanWithLines = Prisma.BudgetPlanGetPayload<{
  include: { lines: { include: { account: { select: { code: true; name: true } } } } }
}>
type PlanLineRow = PlanWithLines["lines"][number]

// POST — create a new version of an existing plan
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "manager")
  if (session instanceof NextResponse) return session

  const { id: planId } = await params
  const { orgId, userId } = session

  // Stage 3 RLS — read, lock check, snapshot, clone-plan + clone-lines in
  // one org-scoped tx (30s: the clone loop is bounded by the plan's line
  // count).
  return withOrgScope(
    orgId,
    async (tx) => {
  // Find original plan
  const plan: PlanWithLines | null = await tx.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    // deletedAt:null (2026-05-31): clone/snapshot only LIVE lines — without it,
    // archived (soft-deleted) budget lines get copied into the new version and
    // resurrected as live rows.
    include: { lines: { where: { deletedAt: null }, include: { account: { select: { code: true, name: true } } } } },
  })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  // Phase 7.G Turn LXIX architect Round-1 ⚠️ closure — period-lock guard
  // (create-version writes snapshotData on the existing plan AND clones
  // it as a new versioned plan, both into the period container).
  const lock = await getActivePeriodLock(tx, orgId, derivePeriodKey(plan))
  if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "POST /api/budgeting/plans/[id]/create-version" })

  // Snapshot current plan state
  const snapshot = {
    lines: plan.lines.map((l: PlanLineRow) => ({
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
      accountId: l.accountId,
      parentId: l.parentId,
      notes: l.notes,
      sortOrder: l.sortOrder,
    })),
  }

  // Save snapshot to current plan
  await tx.budgetPlan.update({
    where: { id: planId },
    data: { snapshotData: snapshot },
  })

  // Determine root of version chain. amendmentOf + version are columns
  // on BudgetPlan (schema.prisma); the typed shape now exposes them.
  const rootId = plan.amendmentOf || plan.id
  const currentVersion = plan.version || 1

  // Clone plan with incremented version
  const newPlan = await tx.budgetPlan.create({
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
    await tx.budgetLine.create({
      data: {
        organizationId: orgId,
        planId: newPlan.id,
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
        // Phase 7.G Turn XL architect Suggestion: pass through monthIndex
        // on plan-version clone so monthly tagging survives versioning.
        monthIndex: line.monthIndex ?? null,
        // Phase 2.1 session 3: accountId is NOT NULL — pass through directly.
        accountId: line.accountId,
        // parentId not cloned — hierarchy re-established separately if needed
      },
    })
  }

  return NextResponse.json({ success: true, data: newPlan }, { status: 201 })
    },
    { timeoutMs: 30_000 },
  )
}
