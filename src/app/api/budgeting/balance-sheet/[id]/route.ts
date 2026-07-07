/**
 * Phase 3 — Balance Sheet line inline edit/delete (closes the BS read-only gap).
 *
 * Mirrors the proven `actuals/[id]` route: period-lock + approved-plan guard +
 * audit log. DELETE is a SOFT delete (deletedAt) to match how every consumer
 * reads BS lines (`deletedAt: null`) and the data-archive restore path.
 *
 * Auth: manager (write). Scope: org + the line's plan.
 */
import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse 423-audit +
// logBudgetChange (fire-and-forget, outlive the scoped tx).
import { prisma, logBudgetChange } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import type { Prisma } from "@prisma/client"

type Db = Prisma.TransactionClient

async function findActiveLockForPlan(tx: Db, orgId: string, planId: string) {
  const plan = await tx.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    select: { periodType: true, year: true, month: true, quarter: true },
  })
  if (!plan) return null
  return getActivePeriodLock(tx, orgId, derivePeriodKey(plan))
}

const updateSchema = z.object({
  // BS amounts can be negative (e.g. accumulated loss / contra accounts).
  amount: z.number().finite().optional(),
  lineType: z.enum(["asset", "liability", "equity"]).optional(),
  subType: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  const orgId = session.orgId
  const userId = session.userId
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  let data: z.infer<typeof updateSchema>
  try {
    data = updateSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // Stage 3 RLS — read/guards/write in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    const old = await tx.balanceSheetLine.findFirst({ where: { id, organizationId: orgId, deletedAt: null } })
    if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const plan = await tx.budgetPlan.findFirst({ where: { id: old.planId }, select: { status: true } })
    if (plan?.status === "approved") {
      return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
    }
    const lock = await findActiveLockForPlan(tx, orgId, old.planId)
    if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "PUT /api/budgeting/balance-sheet/[id]" })

    await tx.balanceSheetLine.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: {
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.lineType !== undefined && { lineType: data.lineType }),
        ...(data.subType !== undefined && { subType: data.subType }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    })
    const updated = await tx.balanceSheetLine.findFirst({ where: { id, organizationId: orgId } })

    if (updated) {
      for (const f of ["amount", "lineType", "subType", "notes"] as const) {
        if (JSON.stringify((old as Record<string, unknown>)[f]) !== JSON.stringify((updated as Record<string, unknown>)[f])) {
          logBudgetChange({ orgId, planId: old.planId, entityType: "balanceSheetLine", entityId: id, action: "update", field: f, oldValue: (old as Record<string, unknown>)[f], newValue: (updated as Record<string, unknown>)[f], snapshot: updated, userId })
        }
      }
    }
    return NextResponse.json({ success: true, data: updated })
  })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  const orgId = session.orgId
  const userId = session.userId
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  // Stage 3 RLS — read/guards/soft-delete in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    const old = await tx.balanceSheetLine.findFirst({ where: { id, organizationId: orgId, deletedAt: null } })
    if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const plan = await tx.budgetPlan.findFirst({ where: { id: old.planId }, select: { status: true } })
    if (plan?.status === "approved") {
      return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
    }
    const lock = await findActiveLockForPlan(tx, orgId, old.planId)
    if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "DELETE /api/budgeting/balance-sheet/[id]" })

    // Soft delete — consumers filter deletedAt:null; restorable via data-archive.
    // deletedBy mirrors CF delete + archiveStamp so restore/audit keeps ownership.
    await tx.balanceSheetLine.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: userId },
    })
    logBudgetChange({ orgId, planId: old.planId, entityType: "balanceSheetLine", entityId: id, action: "delete", oldValue: old, userId })

    return NextResponse.json({ success: true, data: null })
  })
}
