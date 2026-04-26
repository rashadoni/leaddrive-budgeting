import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId, getSession, requireRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { loadAndCompute } from "@/lib/cost-model/db"
import { computePlannedForLine, getPeriodMonths } from "@/lib/budgeting/cost-model-map"
import { logBudgetPlanApprove } from "@/lib/audit/import-helpers"

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

  const plan = await prisma.budgetPlan.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    include: { lines: true, actuals: true },
  })

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

  // ── Role-based approval checks ──
  if (status === "approved" || status === "rejected") {
    if (role !== "admin" && role !== "manager") {
      // Check if user has canApprove on any department
      const approverDepts = await prisma.budgetDepartmentOwner.findMany({
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

  // Capture priorStatus BEFORE the update — needed for the
  // `budget_plan_approve` audit event's `priorStatus` field so consumers
  // can distinguish first-approval vs approve-after-reject vs re-approval-
  // after-revert-to-draft. Single extra read is cheap; alternative would
  // be a transactional read-then-update which adds tx overhead.
  const priorPlan =
    status === "approved"
      ? await prisma.budgetPlan.findFirst({
          where: { id, organizationId: orgId },
          select: { status: true, name: true },
        })
      : null

  const plan = await prisma.budgetPlan.updateMany({
    where: { id, organizationId: orgId },
    data: updateData,
  })

  if (plan.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const updated = await prisma.budgetPlan.findFirst({ where: { id, organizationId: orgId } })

  // Phase 7.F (Turn 25) — emit `budget_plan_approve` on the approve
  // transition. Non-blocking: logger failure surfaces as `auditStale`
  // alongside the successful approval rather than rolling it back.
  // Phase A architect Round-2 (Turn-25): use top-level import — sibling
  // route `plans/route.ts` already eagerly imports the same module so
  // there's no cold-path bundle benefit to lazy-loading here.
  //
  // Known race (architect Round-2): `findFirst` (line above) +
  // `updateMany` (line above that) is two statements outside a
  // transaction. Two concurrent approvers can both read `priorStatus=
  // "pending_approval"` and both succeed at updateMany (idempotent on
  // already-approved), producing two `budget_plan_approve` audit rows
  // with identical priorStatus. Accepted as low-priority race —
  // double-emission is observable in audit feed (no data loss; just
  // slight noise) and the UI prevents double-click via `isApproving`
  // state. Wrap in `prisma.$transaction([find, updateMany])` with
  // serializable isolation if real-world double-emit is observed.
  let auditStale = false
  if (status === "approved" && updated && priorPlan) {
    const auditResult = await logBudgetPlanApprove(prisma, {
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
      await prisma.budgetApprovalComment.create({
        data: {
          organizationId: orgId,
          planId: id,
          userId,
          userName,
          status,
          comment: commentMap[status],
        },
      }).catch(() => {}) // fire-and-forget
    }
  }

  // Freeze auto-planned values when plan is approved
  if (status === "approved") {
    const planData = await prisma.budgetPlan.findFirst({ where: { id, organizationId: orgId } })
    if (planData) {
      const autoLines = await prisma.budgetLine.findMany({
        where: { planId: id, organizationId: orgId, isAutoPlanned: true },
      })
      if (autoLines.length > 0) {
        const cm = await loadAndCompute(orgId).catch(() => null)
        const { count, months } = getPeriodMonths(planData)
        const [forecasts, expForecasts] = await Promise.all([
          prisma.salesForecast.findMany({
            where: { organizationId: orgId, year: planData.year, month: { in: months } },
          }),
          prisma.expenseForecast.findMany({
            where: { organizationId: orgId, year: planData.year, month: { in: months } },
          }),
        ])
        for (const line of autoLines) {
          const computed = computePlannedForLine(line, cm, forecasts, count, months, expForecasts)
          // Defense-in-depth: scope the UPDATE itself by `(id, organizationId)`.
          // `line.id` came from `autoLines` which was already org-scoped above,
          // but a future refactor that reorders or removes that filter would
          // silently allow cross-tenant writes during plan approval. `updateMany`
          // returns count=0 silently for cross-tenant — desired no-leak behavior.
          await prisma.budgetLine.updateMany({
            where: { id: line.id, organizationId: orgId },
            data: { plannedAmount: Math.round(computed * 100) / 100, isAutoPlanned: false },
          })
        }
      }
    }
  }

  // ── Send notifications on status changes ──
  if (status && updated) {
    const users = await prisma.user.findMany({
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
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(req, "admin")
  if (session instanceof NextResponse) return session
  const { orgId, userId } = session

  const { id } = await params

  // Soft-delete: mark the plan as deleted but keep all child rows intact.
  // Every read filters `deletedAt: null`, so the plan disappears from the UI
  // while remaining restorable for 30 days. A cleanup job purges old rows.
  const result = await prisma.budgetPlan.updateMany({
    where: { id, organizationId: orgId, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy: userId },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: "Plan not found or already deleted" }, { status: 404 })
  }

  return NextResponse.json({ success: true, data: null })
}
