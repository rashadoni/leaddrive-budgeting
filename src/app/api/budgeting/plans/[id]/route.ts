import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, getSession, requireRole } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept ONLY for lockedResponse's 423-audit; data
// access rides the withOrgScope tx.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { createNotification } from "@/lib/notifications"
import { loadAndCompute } from "@/lib/cost-model/db"
import { computePlannedForLine, getPeriodMonths } from "@/lib/budgeting/cost-model-map"
import { logBudgetPlanApprove } from "@/lib/audit/import-helpers"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"

const updatePlanSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  status: z.enum(["draft", "pending_approval", "approved", "rejected", "closed"]).optional(),
  notes: z.string().max(2000).optional().nullable(),
  rejectedReason: z.string().max(2000).optional().nullable(),
  comment: z.string().max(2000).optional(),
}).strict()

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  // Stage 3 RLS — read in the org-scoped tx.
  const plan = await withOrgScope(orgId, (tx) =>
    tx.budgetPlan.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { lines: true, actuals: true },
    }),
  )

  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({ success: true, data: plan })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { orgId, userId, role, name: userName } = session
  const { id } = await params

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = updatePlanSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { name, status, notes, rejectedReason } = data

  // Stage 3 RLS — the whole approval workflow (lock check, role check,
  // status write, audit, comment, auto-line freeze, notification fan-out)
  // runs in one org-scoped tx. loadAndCompute + createNotification are
  // platform stubs today (no DB) so they stay outside the tx contract.
  return withOrgScope(
    orgId,
    async (tx) => {
      // Phase L8 finish — period-lock gate on the approve transition.
      // Non-approve status changes + pure metadata edits don't affect the
      // financial-state truth — they're skipped.
      if (status === "approved") {
        const planForLock = await tx.budgetPlan.findFirst({
          where: { id, organizationId: orgId, deletedAt: null },
          select: { id: true, periodType: true, year: true, month: true, quarter: true },
        })
        if (planForLock) {
          const lock = await getActivePeriodLock(tx, orgId, derivePeriodKey(planForLock))
          if (lock)
            return lockedResponse(lock, {
              prisma,
              orgId,
              userId,
              route: "PUT /api/budgeting/plans/[id]",
            })
        }
      }

      // ── Role-based approval checks ──
      if (status === "approved" || status === "rejected") {
        if (role !== "admin" && role !== "manager") {
          // Check if user has canApprove on any department
          const approverDepts = await tx.budgetDepartmentOwner.findMany({
            where: { organizationId: orgId, userId, canApprove: true },
          })
          if (approverDepts.length === 0) {
            return NextResponse.json(
              { error: "Only admin, manager, or designated approvers can approve/reject plans" },
              { status: 403 },
            )
          }
        }
      }

      // Build update data with approval workflow fields
      const updateData: Record<string, any> = {}
      if (name !== undefined) updateData.name = name
      if (notes !== undefined) updateData.notes = notes
      if (status !== undefined) {
        updateData.status = status
        if (status === "pending_approval") {
          updateData.submittedAt = new Date()
          updateData.submittedBy = userId
        }
        if (status === "approved") {
          updateData.approvedAt = new Date()
          updateData.approvedBy = userId
        }
        if (status === "rejected") {
          updateData.rejectedReason = rejectedReason || null
        }
        if (status === "draft") {
          // Reset approval fields when reverting to draft
          updateData.submittedAt = null
          updateData.submittedBy = null
          updateData.approvedAt = null
          updateData.approvedBy = null
          updateData.rejectedReason = null
        }
      }

      // Capture priorStatus BEFORE the update — the in-tx read makes the
      // Turn-25 double-emit race no longer reachable (the whole
      // read-write is now atomic).
      const priorPlan =
        status === "approved"
          ? await tx.budgetPlan.findFirst({
              where: { id, organizationId: orgId },
              select: { status: true, name: true },
            })
          : null

      const plan = await tx.budgetPlan.updateMany({
        where: { id, organizationId: orgId },
        data: updateData,
      })

      if (plan.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

      const updated = await tx.budgetPlan.findFirst({ where: { id, organizationId: orgId } })

      // Phase 7.F (Turn 25) — emit `budget_plan_approve` on the approve
      // transition. Non-blocking: logger failure surfaces as `auditStale`.
      let auditStale = false
      if (status === "approved" && updated && priorPlan) {
        const auditResult = await logBudgetPlanApprove(tx, {
          organizationId: orgId,
          actorUserId: userId || null,
          planId: updated.id,
          planName: priorPlan.name,
          approvedBy: userId || "system",
          priorStatus: priorPlan.status ?? "unknown",
          context: {
            route: "/api/budgeting/plans/[id]",
            userAgent: req.headers.get("user-agent") ?? undefined,
          },
        })
        if (!auditResult.ok) auditStale = true
      }

      // ── Auto-create approval comment on status transitions ──
      if (status && updated) {
        const commentMap: Record<string, string> = {
          pending_approval: data.comment || "Plan submitted for approval",
          approved: data.comment || "Plan approved",
          rejected: data.comment || rejectedReason || "Plan rejected",
          closed: data.comment || "Plan closed",
          draft: data.comment || "Plan reverted to draft",
        }
        if (commentMap[status]) {
          await tx.budgetApprovalComment.create({
            data: {
              organizationId: orgId,
              planId: id,
              userId,
              userName,
              status,
              comment: commentMap[status],
            },
          }).catch(() => {}) // best-effort (awaited so it stays in-tx)
        }
      }

      // Freeze auto-planned values when plan is approved
      if (status === "approved") {
        const planData = await tx.budgetPlan.findFirst({ where: { id, organizationId: orgId } })
        if (planData) {
          const autoLines = await tx.budgetLine.findMany({
            where: { planId: id, organizationId: orgId, isAutoPlanned: true, deletedAt: null },
          })
          if (autoLines.length > 0) {
            const cm = await loadAndCompute(orgId).catch(() => null)
            const { count, months } = getPeriodMonths(planData)
            const forecasts = await tx.salesForecast.findMany({
              where: { organizationId: orgId, year: planData.year, month: { in: months } },
            })
            const expForecasts = await tx.expenseForecast.findMany({
              where: { organizationId: orgId, year: planData.year, month: { in: months } },
            })
            for (const line of autoLines) {
              const computed = computePlannedForLine(line, cm, forecasts, count, months, expForecasts)
              await tx.budgetLine.updateMany({
                where: { id: line.id, organizationId: orgId },
                data: { plannedAmount: Math.round(computed * 100) / 100, isAutoPlanned: false },
              })
            }
          }
        }
      }

      // ── Send notifications on status changes (createNotification is a
      // no-op stub today; the user read stays in-tx). ──
      if (status && updated) {
        const users = await tx.user.findMany({
          where: { organizationId: orgId },
          select: { id: true },
        })

        const titleMap: Record<string, string> = {
          pending_approval: "Budget submitted for approval",
          approved: "Budget approved",
          rejected: "Budget rejected",
          closed: "Budget closed",
        }
        const typeMap: Record<string, string> = {
          pending_approval: "info",
          approved: "success",
          rejected: "warning",
          closed: "info",
        }

        if (titleMap[status]) {
          for (const user of users) {
            await createNotification({
              organizationId: orgId,
              userId: user.id,
              type: (typeMap[status] || "info") as "info" | "warning" | "error" | "success",
              title: titleMap[status],
              message: `Plan "${updated.name}" — ${titleMap[status].toLowerCase()}`,
              entityType: "budget_plan",
              entityId: id,
            })
          }
        }
      }

      return NextResponse.json({ success: true, data: updated, auditStale })
    },
    { timeoutMs: 20_000 },
  )
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(req, "admin")
  if (session instanceof NextResponse) return session
  const { orgId, userId } = session

  const { id } = await params

  // Stage 3 RLS — lock check + soft-delete in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
    // Phase L8 finish — period-lock gate. Plan soft-delete hides the
    // plan + its locked BudgetLines from every read path; reject 423 if
    // the plan's period is signed off (admin should explicitly unlock
    // first, leaving an audit trail).
    const planForLock = await tx.budgetPlan.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: { id: true, periodType: true, year: true, month: true, quarter: true },
    })
    if (planForLock) {
      const lock = await getActivePeriodLock(tx, orgId, derivePeriodKey(planForLock))
      if (lock)
        return lockedResponse(lock, {
          prisma,
          orgId,
          userId,
          route: "DELETE /api/budgeting/plans/[id]",
        })
    }

    // Soft-delete: mark the plan as deleted but keep all child rows intact.
    // Every read filters `deletedAt: null`, so the plan disappears from the UI
    // while remaining restorable for 30 days. A cleanup job purges old rows.
    const result = await tx.budgetPlan.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: userId },
    })

    if (result.count === 0) {
      return NextResponse.json({ error: "Plan not found or already deleted" }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: null })
  })
}
