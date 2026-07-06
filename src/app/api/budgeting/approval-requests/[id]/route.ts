/**
 * Phase 7.G Turn LXXI (Phase 4.3 — approval workflow MVP).
 *
 * PATCH /api/budgeting/approval-requests/[id]
 *   body: { action: "approve" | "reject" | "cancel", comment?: string }
 *
 * State transitions (enforced by `canTransition`):
 *   pending → approved (admin/manager+ only; v1 applies the change inline)
 *   pending → rejected (admin/manager+ only)
 *   pending → cancelled (the original requester only — withdraw)
 *
 * Apply-on-approve: v1 ships `period_unlock` apply-logic (removes the
 * lock from `Organization.lockedPeriods`). Other request types
 * (line/actual create/update/delete) are scaffolded — the request is
 * approved and `appliedAt` is set, but the actual mutation is intentionally
 * NOT performed yet. Reason: those mutations involve currency conversion,
 * dept-access enforcement, and audit chains that are best left to the
 * existing route handlers. Turn LXXII will wire the mutation routes to
 * accept an `approvalRequestId` query param that bypasses the 403/423
 * gate when an approved request matches. Doc'd as the v1 escape hatch.
 *
 * Audit: approve fires `period_lock_remove` for period_unlock requests;
 * other types defer audit to the eventual mutation route call.
 *
 * Rate-limit: 30/min keyed on userId — same as POST on parent route.
 */

import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireAuth, hasRole, isAuthError } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { enforceRateLimit } from "@/lib/rate-limit"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import { withOrgScope } from "@/lib/db/with-org-scope"
import {
  parseLockedPeriods,
  removePeriodLock,
  findLockForPeriod,
} from "@/lib/budgeting/period-lock"
import {
  canTransition,
  nextStatus,
  isTerminalStatus,
  type ApprovalRequestAction,
  type PeriodUnlockChange,
  type TradeCampaignActivateChange,
} from "@/lib/budgeting/approval-request"
import { statusAfterDecision } from "@/lib/trade/campaigns"
import { notifyApprovalReviewed } from "@/lib/budgeting/approval-notifications"
import type { Prisma } from "@prisma/client"

const RATE_LIMIT = { name: "approval-requests-patch", max: 30, windowMs: 60_000 }

const patchBodySchema = z
  .object({
    action: z.enum(["approve", "reject", "cancel"]),
    comment: z.string().max(500).optional(),
  })
  .strict()

// Phase 8 D5(c) (2026-05-28) — PATCH handler RLS wrap shipped. The
// read + validation phase runs outside `withOrgScope` (it can short-
// circuit 404 / 400 / 403 without opening a Postgres tx); the
// mutation phase (Organization.update + ApprovalRequest.update +
// logAuditEvent) runs inside one withOrgScope so every write picks
// up `app.organization_id` at the DB layer. notifyApprovalReviewed
// fires AFTER the tx commits — email is best-effort and a Redis /
// SMTP blip shouldn't roll back the state change.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Auth: any authenticated user, but action-specific role check below.
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  const { id } = await params

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  let parsed
  try {
    parsed = patchBodySchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const action: ApprovalRequestAction = parsed.action

  // Org-scoped read — protects against cross-tenant id guesses.
  const request = await prisma.approvalRequest.findFirst({
    where: { id, organizationId: session.orgId },
  })
  if (!request) {
    return NextResponse.json({ error: "Approval request not found" }, { status: 404 })
  }

  // State machine guard.
  if (isTerminalStatus(request.status) || !canTransition(request.status, action)) {
    return NextResponse.json(
      { error: `Cannot ${action} a request in status "${request.status}"` },
      { status: 409 }, // Conflict
    )
  }

  // Action-specific authorization (LXXI follow-up: use already-resolved
  // session.role with `hasRole` instead of re-running requireRole — saves
  // 1 session lookup per PATCH).
  //   - approve / reject → manager+ (CFO-class action)
  //   - cancel → original requester OR admin (withdraw your own request,
  //     or admin sweep stale ones)
  if (action === "approve" || action === "reject") {
    if (!hasRole(session.role, "manager")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  } else if (action === "cancel") {
    const isRequester = request.requestedBy === session.userId
    if (!isRequester && !hasRole(session.role, "admin")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const now = new Date()
  const newStatus = nextStatus(action)

  // Phase 8 D5(c) — mutations inside withOrgScope so every write
  // (Organization.lockedPeriods update, ApprovalRequest.update, audit
  // insert) picks up `app.organization_id`. Validation that can return
  // 404 stays inside the tx because we still need the org-aware
  // findUnique for the same orgId session var. Email notification
  // fires AFTER tx commits.
  type TxResult = {
    updated: typeof request
    auditStale: boolean
    orgNotFound: boolean
  }
  const txResult = await withOrgScope<TxResult>(session.orgId, async (tx) => {
    let appliedAt: Date | null = null
    let auditStale = false
    let orgNotFound = false

    if (action === "approve" && request.requestType === "period_unlock") {
      const change = request.proposedChange as unknown as PeriodUnlockChange
      const org = await tx.organization.findUnique({
        where: { id: session.orgId },
        select: { id: true, lockedPeriods: true },
      })
      if (!org) {
        orgNotFound = true
        return { updated: request, auditStale, orgNotFound }
      }
      const currentLocks = parseLockedPeriods(org.lockedPeriods)
      const removedLock = findLockForPeriod(currentLocks, change.period)
      const nextLocks = removePeriodLock(currentLocks, change.period)
      if (nextLocks.length !== currentLocks.length) {
        await tx.organization.update({
          where: { id: org.id },
          data: {
            lockedPeriods: nextLocks as unknown as Prisma.InputJsonValue,
          },
        })
        appliedAt = now
        // Mirror the audit shape of /api/budgeting/period-locks DELETE so
        // CFO compliance gets a consistent trail regardless of unlock origin.
        if (removedLock) {
          const auditResult = await logAuditEvent(tx, {
            organizationId: session.orgId,
            actorUserId: session.userId,
            event: {
              action: "period_lock_remove",
              entityType: "Organization",
              entityId: org.id,
              metadata: {
                period: change.period,
                removedLock: {
                  lockedAt: removedLock.lockedAt,
                  lockedBy: removedLock.lockedBy,
                  reason: removedLock.reason,
                },
              },
            },
            context: buildAuditContext({
              route: "/api/budgeting/approval-requests/[id] (approve)",
              userAgent: req.headers.get("user-agent") ?? undefined,
            }),
          })
          if (!auditResult.ok) auditStale = true
        }
      } else {
        // Lock no longer present (raced with /api/budgeting/period-locks
        // DELETE, or admin manually removed). Mark approved + applied=now
        // anyway — the requester's intent is satisfied.
        appliedAt = now
      }
    }

    // Phase 9.4 — trade campaign activation. Unlike the budget-line types
    // (which defer the mutation to their own routes), the campaign status
    // flip IS the whole change, so it applies inline for all three
    // actions: approve → approved, reject → rejected, cancel → draft.
    if (request.requestType === "trade_campaign_activate") {
      const change = request.proposedChange as unknown as TradeCampaignActivateChange
      const campaignStatus = statusAfterDecision(action)
      // Guard: only flip a campaign that is still waiting on THIS request —
      // protects against a stale request racing a resubmission.
      const flipped = await tx.tradeCampaign.updateMany({
        where: {
          id: change.campaignId,
          organizationId: session.orgId,
          status: "pending_approval",
          deletedAt: null,
        },
        data: {
          status: campaignStatus,
          approvalRequestId: action === "approve" ? request.id : null,
        },
      })
      if (flipped.count === 1) {
        if (action === "approve") appliedAt = now
        if (action === "approve" || action === "reject") {
          const auditResult = await logAuditEvent(tx, {
            organizationId: session.orgId,
            actorUserId: session.userId,
            event: {
              action: "trade_campaign_review",
              entityType: "TradeCampaign",
              entityId: change.campaignId,
              metadata: {
                decision: action === "approve" ? "approved" : "rejected",
                campaignCode: change.campaignCode,
                campaignName: change.campaignName,
                plannedBudgetAmount: change.plannedBudgetAmount,
              },
            },
            context: buildAuditContext({
              route: `/api/budgeting/approval-requests/[id] (${action})`,
              userAgent: req.headers.get("user-agent") ?? undefined,
            }),
          })
          if (!auditResult.ok) auditStale = true
        }
      }
      // flipped.count === 0 → campaign was deleted/resubmitted meanwhile;
      // the request still transitions (reviewer's decision is recorded),
      // the campaign keeps its newer state.
    }

    const updated = await tx.approvalRequest.update({
      where: { id },
      data: {
        status: newStatus,
        reviewedBy: action === "cancel" ? null : session.userId,
        reviewedAt: action === "cancel" ? null : now,
        reviewComment: parsed.comment ?? null,
        appliedAt,
      },
    })
    return { updated, auditStale, orgNotFound }
  })

  if (txResult.orgNotFound) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 })
  }
  const updated = txResult.updated
  const auditStale = txResult.auditStale

  // Phase 7.G Turn LXXIII (Phase 4.3 sub-3 — email notifications).
  // Approve / reject → notify the original requester. Cancel intentionally
  // emits NO email — requester withdrew their own intent, no audience.
  // Best-effort fire-and-forget; failures don't reverse the state change.
  if (action === "approve" || action === "reject") {
    void notifyApprovalReviewed(prisma, {
      event: action === "approve" ? "approved" : "rejected",
      requesterUserId: request.requestedBy,
      reviewerUserId: session.userId,
      requestType: request.requestType,
      reviewComment: parsed.comment ?? null,
    }).catch(() => {})
  }

  const responseBody: { request: typeof updated; auditStale?: boolean } = { request: updated }
  if (auditStale) responseBody.auditStale = true
  return NextResponse.json(responseBody, { status: 200 })
}
