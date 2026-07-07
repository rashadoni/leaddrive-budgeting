import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getSession } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's fire-and-forget
// 423-audit + logBudgetChange (both must outlive the scoped tx); all
// data access rides the withOrgScope tx client.
import { prisma, logBudgetChange } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { consumeApprovalRequest, claimApprovalRequest } from "@/lib/budgeting/approval-request"
import type { Prisma, ApprovalRequestType } from "@prisma/client"

type Db = Prisma.TransactionClient

/**
 * Phase 7.G Turn LXVIII follow-up — period-lock check helper for [id]
 * PUT/DELETE handlers. Loads plan (with period fields) by id+org, derives
 * the period key, and returns the lock record if active. The plan-load is
 * also load-bearing for cross-tenant safety: an un-org'd plan returns null
 * (no lock found, but the calling handler should also re-verify the line
 * row belongs to the org via its own organizationId filter).
 *
 * Phase 7.G Turn LXIX cleanup: `lockedResponse` migrated to shared
 * `period-lock-http.ts` (was inline 3 times, now centralized).
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

/**
 * Phase 7.G Turn LXXII (Phase 4.3 — approval-request bypass).
 * Resolves `?approvalRequestId=X` to a usable bypass token. Returns the
 * loaded request when valid (matches expected type, target id, planId,
 * requester, not already applied, status=approved). Caller skips both
 * 403 (approved plan) and 423 (locked period) gates when present, then
 * MUST call `claimApprovalRequest` (atomic) to lock-in the one-shot.
 *
 * Turn LXXII architect ⚠️ #1 closure — `expectedPlanId` threaded through.
 */
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

const updateLineSchema = z.object({
  category: z.string().min(1).max(500).optional(),
  department: z.string().max(200).optional().nullable(),
  lineType: z.string().max(50).optional(),
  lineSubtype: z.string().max(50).optional().nullable(),
  plannedAmount: z.number().min(0).max(999999999).optional(),
  forecastAmount: z.number().min(0).max(999999999).optional().nullable(),
  unitPrice: z.number().min(0).max(999999999).optional().nullable(),
  unitCost: z.number().min(0).max(999999999).optional().nullable(),
  quantity: z.number().min(0).max(999999999).optional().nullable(),
  costModelKey: z.string().max(200).optional().nullable(),
  isAutoActual: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
  parentId: z.string().max(100).optional().nullable(),
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
    data = updateLineSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // `category` accepted in the body for back-compat but NOT written: Phase
  // 2.1 dropped BudgetLine.category (→ accountId FK); writing it 500'd.
  const { department, lineType, lineSubtype, plannedAmount, forecastAmount, unitPrice, unitCost, quantity, costModelKey, isAutoActual, notes, parentId } = data

  if (plannedAmount !== undefined && Number(plannedAmount) < 0) {
    return NextResponse.json({ error: "Amount cannot be negative" }, { status: 400 })
  }
  if (forecastAmount !== undefined && forecastAmount != null && Number(forecastAmount) < 0) {
    return NextResponse.json({ error: "Forecast amount cannot be negative" }, { status: 400 })
  }

  // Stage 3 RLS — read/bypass/lock-check/write in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    // Fetch old state for change log + planId for bypass scope check
    const line = await tx.budgetLine.findFirst({ where: { id, organizationId: orgId } })

    // Phase 7.G Turn LXXII (Phase 4.3 — approval-request bypass for [id] PUT).
    // Pass line.planId as expectedPlanId so bypass refuses cross-plan reuse
    // (Turn LXXII architect ⚠️ #1 closure).
    const bypassRequest = userId && line
      ? await resolveBypass(tx, req, orgId, userId, "budget_line_update", id, line.planId)
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

    if (line && !bypassRequest) {
      const plan = await tx.budgetPlan.findFirst({ where: { id: line.planId }, select: { status: true } })
      if (plan?.status === "approved") {
        return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
      }
      const lock = await findActiveLockForPlan(tx, orgId, line.planId)
      if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "PUT /api/budgeting/lines/[id]" })
    }

    const result = await tx.budgetLine.updateMany({
      where: { id, organizationId: orgId },
      data: {
        ...(department !== undefined && { department }),
        ...(lineType !== undefined && { lineType }),
        ...(lineSubtype !== undefined && { lineSubtype: lineSubtype || null }),
        ...(plannedAmount !== undefined && { plannedAmount: Number(plannedAmount) }),
        ...(forecastAmount !== undefined && { forecastAmount: forecastAmount != null ? Number(forecastAmount) : null }),
        ...(unitPrice !== undefined && { unitPrice: unitPrice != null ? Number(unitPrice) : null }),
        ...(unitCost !== undefined && { unitCost: unitCost != null ? Number(unitCost) : null }),
        ...(quantity !== undefined && { quantity: quantity != null ? Number(quantity) : null }),
        ...(costModelKey !== undefined && { costModelKey: costModelKey || null }),
        ...(isAutoActual !== undefined && { isAutoActual: Boolean(isAutoActual) }),
        ...(notes !== undefined && { notes }),
        ...(parentId !== undefined && { parentId: parentId || null }),
      },
    })

    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const updated = await tx.budgetLine.findFirst({ where: { id, organizationId: orgId } })

    if (updated && line) {
      // Log each changed field (logBudgetChange stays on the global client —
      // fire-and-forget must outlive this tx).
      const fields = ["department", "lineType", "lineSubtype", "plannedAmount", "forecastAmount", "unitPrice", "unitCost", "quantity", "costModelKey", "isAutoActual", "notes", "parentId"] as const
      for (const f of fields) {
        const oldVal = (line as any)[f]
        const newVal = (updated as any)[f]
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          logBudgetChange({ orgId, planId: line.planId, entityType: "line", entityId: id, action: "update", field: f, oldValue: oldVal, newValue: newVal, snapshot: updated })
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
    const lineToDelete = await tx.budgetLine.findFirst({ where: { id, organizationId: orgId } })

    // Phase 7.G Turn LXXII (Phase 4.3 — approval-request bypass for [id] DELETE).
    const bypassRequest = userId && lineToDelete
      ? await resolveBypass(tx, req, orgId, userId, "budget_line_delete", id, lineToDelete.planId)
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

    if (lineToDelete && !bypassRequest) {
      const plan = await tx.budgetPlan.findFirst({ where: { id: lineToDelete.planId }, select: { status: true } })
      if (plan?.status === "approved") {
        return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
      }
      const lock = await findActiveLockForPlan(tx, orgId, lineToDelete.planId)
      if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "DELETE /api/budgeting/lines/[id]" })
    }

    await tx.budgetLine.deleteMany({ where: { id, organizationId: orgId } })

    if (lineToDelete) {
      logBudgetChange({ orgId, planId: lineToDelete.planId, entityType: "line", entityId: id, action: "delete", oldValue: lineToDelete })
    }

    return NextResponse.json({ success: true, data: null })
  })
}
