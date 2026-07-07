/**
 * Phase 3 — Cash Flow entry inline edit/delete (closes the CF read-only gap).
 *
 * cash_flow_entries are org+year scoped (no plan), so the period-lock check
 * uses the entry's own year+month (mirrors the CF POST route). DELETE is a
 * SOFT delete (deletedAt). Audit via the generic audit log (no planId).
 *
 * Auth: manager (write).
 */
import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse 423-audit +
// logBudgetChange (fire-and-forget, outlive the scoped tx).
import { prisma, logBudgetChange } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { findFirstActiveLockInPeriods } from "@/lib/budgeting/period-lock"
import { lockedResponse, containingPeriodKeys } from "@/lib/budgeting/period-lock-http"

// cash_flow_entries have no plan; use a stable sentinel planId in the change
// log (budgetChangeLog.planId is a plain string column, not a FK) so CF edits
// are auditable without colliding with real plan ids.
const cfPlanKey = (year: number) => `cashflow:${year}`

const updateSchema = z.object({
  amount: z.number().min(0).max(999999999).optional(),
  entryType: z.enum(["inflow", "outflow"]).optional(),
  description: z.string().max(2000).nullable().optional(),
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

  // Stage 3 RLS — read/lock-check/write in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    const old = await tx.cashFlowEntry.findFirst({ where: { id, organizationId: orgId, deletedAt: null } })
    if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const lock = await findFirstActiveLockInPeriods(tx, orgId, containingPeriodKeys(old.year, old.month))
    if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "PUT /api/budgeting/cash-flow/[id]" })

    await tx.cashFlowEntry.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: {
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.entryType !== undefined && { entryType: data.entryType }),
        ...(data.description !== undefined && { description: data.description }),
      },
    })
    const updated = await tx.cashFlowEntry.findFirst({ where: { id, organizationId: orgId } })

    if (updated) {
      for (const f of ["amount", "entryType", "description"] as const) {
        if (JSON.stringify((old as Record<string, unknown>)[f]) !== JSON.stringify((updated as Record<string, unknown>)[f])) {
          logBudgetChange({ orgId, planId: cfPlanKey(old.year), entityType: "cashFlowEntry", entityId: id, action: "update", field: f, oldValue: (old as Record<string, unknown>)[f], newValue: (updated as Record<string, unknown>)[f], snapshot: updated, userId })
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

  // Stage 3 RLS — read/lock-check/soft-delete in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    const old = await tx.cashFlowEntry.findFirst({ where: { id, organizationId: orgId, deletedAt: null } })
    if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const lock = await findFirstActiveLockInPeriods(tx, orgId, containingPeriodKeys(old.year, old.month))
    if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "DELETE /api/budgeting/cash-flow/[id]" })

    await tx.cashFlowEntry.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: userId ?? null },
    })
    logBudgetChange({ orgId, planId: cfPlanKey(old.year), entityType: "cashFlowEntry", entityId: id, action: "delete", oldValue: old, userId })

    return NextResponse.json({ success: true, data: null })
  })
}
