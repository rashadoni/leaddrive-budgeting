import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getSession } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's 423-audit +
// logBudgetChange (both fire-and-forget, must outlive the scoped tx).
import { prisma, logBudgetChange } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { consumeApprovalRequest, claimApprovalRequest } from "@/lib/budgeting/approval-request"
import { deriveMonthIndex } from "@/lib/budgeting/derive-month-index"
import type { Prisma, ApprovalRequestType } from "@prisma/client"

type Db = Prisma.TransactionClient

/**
 * Phase 7.G Turn LXVIII follow-up — period-lock helpers.
 * See `lines/[id]/route.ts` for the design rationale.
 *
 * Phase 7.G Turn LXIX cleanup: `lockedResponse` migrated to shared
 * `period-lock-http.ts` module.
 */
async function findActiveLockForPlan(tx: Db, orgId: string, planId: string) {
  const plan = await tx.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    select: { periodType: true, year: true, month: true, quarter: true },
  })
  if (!plan) return null
  const periodKey = derivePeriodKey(plan)
  return getActivePeriodLock(tx, orgId, periodKey)
}

/** Phase 7.G Turn LXXII (Phase 4.3 — approval-request bypass) + ⚠️ #1 closure. */
async function resolveBypass(
  tx: Db,
  req: NextRequest,
  orgId: string,
  userId: string,
  expectedType: ApprovalRequestType,
  expectedTargetId: string,
  expectedPlanId: string | null,
) {
  const id = req.nextUrl.searchParams.get("approvalRequestId")
  if (!id) return null
  return consumeApprovalRequest(tx, {
    requestId: id,
    orgId,
    userId,
    expectedType,
    expectedTargetId,
    expectedPlanId,
  })
}

const updateActualSchema = z.object({
  actualAmount: z.number().min(0).max(999999999).optional(),
  category: z.string().min(1).max(500).optional(),
  department: z.string().max(200).optional().nullable(),
  lineType: z.string().max(50).optional(),
  expenseDate: z.string().max(50).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  const orgId = session?.orgId ?? null
  const userId = session?.userId ?? null
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = updateActualSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { actualAmount, category, department, lineType, expenseDate, description } = data

  // Stage 3 RLS — read/bypass/lock-check/write in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    const oldActual = await tx.budgetActual.findFirst({ where: { id, organizationId: orgId } })

    // Phase 7.G Turn LXXII (Phase 4.3 — approval-request bypass) +
    // ⚠️ #1 (planId scope) + ⚠️ #2 (atomic claim) closure.
    const bypassRequest = userId && oldActual
      ? await resolveBypass(tx, req, orgId, userId, "budget_actual_update", id, oldActual.planId)
      : null
    if (bypassRequest) {
      const claimed = await claimApprovalRequest(tx, bypassRequest.id)
      if (!claimed) {
        return NextResponse.json(
          { error: "Approval request already used by a concurrent mutation" },
          { status: 409 },
        )
      }
    }

    if (oldActual && !bypassRequest) {
      // Phase 7.G Turn LXX (CARRYOVER row close, was turns-open=3):
      // approval-status check parity with DELETE handler. Without this,
      // a manager could edit actuals on an approved plan.
      const plan = await tx.budgetPlan.findFirst({ where: { id: oldActual.planId }, select: { status: true } })
      if (plan?.status === "approved") {
        return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
      }
      const lock = await findActiveLockForPlan(tx, orgId, oldActual.planId)
      if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "PUT /api/budgeting/actuals/[id]" })
    }

    // Phase 3.1 v1.2 — re-stamp monthIndex when expenseDate is supplied
    // in the update payload. Keeps the per-month attribution accurate
    // if the user corrects the date of an existing entry.
    const monthIndexUpdate =
      expenseDate !== undefined ? { monthIndex: deriveMonthIndex(expenseDate) } : {}
    const result = await tx.budgetActual.updateMany({
      where: { id, organizationId: orgId },
      data: {
        ...(actualAmount !== undefined && { actualAmount: Number(actualAmount) }),
        ...(category !== undefined && { category }),
        ...(department !== undefined && { department }),
        ...(lineType !== undefined && { lineType }),
        ...(expenseDate !== undefined && { expenseDate }),
        ...monthIndexUpdate,
        ...(description !== undefined && { description }),
      },
    })

    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const updated = await tx.budgetActual.findFirst({ where: { id, organizationId: orgId } })

    if (updated && oldActual) {
      const fields = ["actualAmount", "category", "department", "lineType", "expenseDate", "description"] as const
      for (const f of fields) {
        const oldVal = (oldActual as any)[f]
        const newVal = (updated as any)[f]
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          logBudgetChange({ orgId, planId: oldActual.planId, entityType: "actual", entityId: id, action: "update", field: f, oldValue: oldVal, newValue: newVal, snapshot: updated })
        }
      }
    }

    // appliedAt was already stamped atomically via claimApprovalRequest above.

    return NextResponse.json({ success: true, data: updated })
  })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  const orgId = session?.orgId ?? null
  const userId = session?.userId ?? null
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  // Stage 3 RLS — read/bypass/lock-check/delete in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    // Fetch full state before deletion for change log + planId for bypass scope check
    const actualToDelete = await tx.budgetActual.findFirst({ where: { id, organizationId: orgId } })

    // Phase 7.G Turn LXXII (Phase 4.3 — approval-request bypass) +
    // ⚠️ #1+#2 closure: planId scope check + atomic claim.
    const bypassRequest = userId && actualToDelete
      ? await resolveBypass(tx, req, orgId, userId, "budget_actual_delete", id, actualToDelete.planId)
      : null
    if (bypassRequest) {
      const claimed = await claimApprovalRequest(tx, bypassRequest.id)
      if (!claimed) {
        return NextResponse.json(
          { error: "Approval request already used by a concurrent mutation" },
          { status: 409 },
        )
      }
    }

    if (actualToDelete && !bypassRequest) {
      const plan = await tx.budgetPlan.findFirst({ where: { id: actualToDelete.planId }, select: { status: true } })
      if (plan?.status === "approved") {
        return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
      }
      const lock = await findActiveLockForPlan(tx, orgId, actualToDelete.planId)
      if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "DELETE /api/budgeting/actuals/[id]" })
    }

    await tx.budgetActual.deleteMany({ where: { id, organizationId: orgId } })

    if (actualToDelete) {
      logBudgetChange({ orgId, planId: actualToDelete.planId, entityType: "actual", entityId: id, action: "delete", oldValue: actualToDelete })
    }

    return NextResponse.json({ success: true, data: null })
  })
}
