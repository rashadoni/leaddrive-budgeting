/**
 * Phase 7.Q (2026-08-06) — edit / delete one budget assumption.
 *
 * Until now `/api/budgeting/assumptions` had GET and POST only, and the tab
 * that renders the rows had no mutation at all. A driver you can create but
 * never correct is worse than none: the first typo is permanent and the tab
 * stops being trusted.
 *
 * Mirrors the proven `balance-sheet/[id]` shape — manager role, approved-plan
 * guard, period lock, audit on every changed field.
 *
 * DELETE is a HARD delete, unlike its balance-sheet counterpart, because
 * `BudgetAssumption` has no `deletedAt` column and adding one is a wider change
 * than this slice earns. The evidence is not lost: the full pre-delete row goes
 * to `logBudgetChange` as `oldValue`, which is the same audit trail a soft
 * delete would have been read through.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's 423-audit +
// logBudgetChange (fire-and-forget, outlives the scoped tx).
import { prisma, logBudgetChange } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { parseAssumptionPatch } from "@/lib/budgeting/assumption-input"
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

/** Fields the audit walks after a successful update. */
const AUDITED_FIELDS = [
  "category",
  "key",
  "label",
  "value",
  "unit",
  "period",
  "notes",
  "sortOrder",
  "companyId",
] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const parsed = parseAssumptionPatch(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const patch = parsed.value

  return withOrgScope(orgId, async (tx) => {
    const old = await tx.budgetAssumption.findFirst({ where: { id, organizationId: orgId } })
    if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const plan = await tx.budgetPlan.findFirst({
      where: { id: old.planId },
      select: { status: true },
    })
    if (plan?.status === "approved") {
      return NextResponse.json(
        { error: "Plan is approved — changes are not allowed" },
        { status: 403 },
      )
    }
    const lock = await findActiveLockForPlan(tx, orgId, old.planId)
    if (lock) {
      return lockedResponse(lock, {
        prisma,
        orgId,
        userId,
        route: "PATCH /api/budgeting/assumptions/[id]",
      })
    }

    // Cross-tenant guard on re-pointing a row at a company. `companyId: null`
    // is a legitimate edit — it demotes a company override back to the
    // plan-level default — so only a non-null value is checked.
    if (patch.companyId) {
      const company = await tx.company.findFirst({
        where: { id: patch.companyId, organizationId: orgId },
        select: { id: true },
      })
      if (!company) {
        return NextResponse.json(
          { error: "Company not found in this organization" },
          { status: 404 },
        )
      }
    }

    await tx.budgetAssumption.updateMany({
      where: { id, organizationId: orgId },
      data: patch,
    })
    const updated = await tx.budgetAssumption.findFirst({ where: { id, organizationId: orgId } })

    if (updated) {
      for (const f of AUDITED_FIELDS) {
        const before = (old as Record<string, unknown>)[f]
        const after = (updated as Record<string, unknown>)[f]
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          logBudgetChange({
            orgId,
            planId: old.planId,
            entityType: "budgetAssumption",
            entityId: id,
            action: "update",
            field: f,
            oldValue: before,
            newValue: after,
            snapshot: updated,
            userId,
          })
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

  return withOrgScope(orgId, async (tx) => {
    const old = await tx.budgetAssumption.findFirst({ where: { id, organizationId: orgId } })
    if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const plan = await tx.budgetPlan.findFirst({
      where: { id: old.planId },
      select: { status: true },
    })
    if (plan?.status === "approved") {
      return NextResponse.json(
        { error: "Plan is approved — changes are not allowed" },
        { status: 403 },
      )
    }
    const lock = await findActiveLockForPlan(tx, orgId, old.planId)
    if (lock) {
      return lockedResponse(lock, {
        prisma,
        orgId,
        userId,
        route: "DELETE /api/budgeting/assumptions/[id]",
      })
    }

    await tx.budgetAssumption.deleteMany({ where: { id, organizationId: orgId } })
    // Hard delete — the whole row is the audit's only remaining copy.
    logBudgetChange({
      orgId,
      planId: old.planId,
      entityType: "budgetAssumption",
      entityId: id,
      action: "delete",
      oldValue: old,
      userId,
    })

    return NextResponse.json({ success: true, data: null })
  })
}
