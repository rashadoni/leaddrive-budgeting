/**
 * Phase 7.G Turn LXXI (Phase 4.3 — approval workflow foundation).
 *
 * Pure helpers for `ApprovalRequest` lifecycle. State machine:
 *
 *     pending  ───approve──▶  approved  (terminal, change applied)
 *                │
 *                ├───reject──▶  rejected (terminal, no change)
 *                │
 *                └──cancel──▶   cancelled (terminal, requester withdrew)
 *
 * Type-shape guards for `proposedChange` Json field. Apply-logic
 * (turning an approved request into actual mutations) lives in the
 * route handler, not here — keeps this module Prisma-free for
 * fast node-env tests.
 *
 * Why a state machine module: the route handlers will fire 3
 * different terminal transitions; without a single source of truth
 * for "is this transition legal", drift between PATCH-approve and
 * PATCH-reject would silently allow double-approval bugs.
 */

import type { ApprovalRequestStatus, ApprovalRequestType, PrismaClient, ApprovalRequest } from "@prisma/client"

/** Statuses that can transition to a terminal state. */
const ACTIVE_STATUSES: readonly ApprovalRequestStatus[] = ["pending"]

/** Statuses with no further transitions. */
const TERMINAL_STATUSES: readonly ApprovalRequestStatus[] = ["approved", "rejected", "cancelled"]

/** Valid action verbs for state transitions. */
export type ApprovalRequestAction = "approve" | "reject" | "cancel"

/**
 * Determines if a request in the given state can transition via `action`.
 * Pending requests support all 3 verbs; terminal requests support none
 * (idempotency at the DB level — repeat requests should be no-ops, not
 * errors, but the state machine itself is strict).
 */
export function canTransition(
  currentStatus: ApprovalRequestStatus,
  action: ApprovalRequestAction,
): boolean {
  if (!ACTIVE_STATUSES.includes(currentStatus)) return false
  // From "pending" all 3 actions are legal.
  return action === "approve" || action === "reject" || action === "cancel"
}

/** Maps an action to the resulting terminal status. */
export function nextStatus(action: ApprovalRequestAction): ApprovalRequestStatus {
  switch (action) {
    case "approve": return "approved"
    case "reject": return "rejected"
    case "cancel": return "cancelled"
  }
}

/**
 * Predicate — terminal status (no further transitions).
 * Used by route handlers to surface "already reviewed" errors with
 * a uniform shape regardless of which terminal state was entered.
 */
export function isTerminalStatus(status: ApprovalRequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

// ──────────────────────────────────────────────────────────────────
// proposedChange shape guards
// ──────────────────────────────────────────────────────────────────

/**
 * Shape contracts per requestType — Json field at the DB level, but
 * this module guarantees the produced shape at create-time and the
 * read shape at apply-time. Schema-driven would be Zod; for v1 we
 * keep it as TypeScript types + isXxx guards. Migrate to Zod when
 * an external system (cron job, CLI, API consumer) starts producing
 * approval requests — for now the API route is the only producer.
 */

export interface BudgetLineCreateChange {
  category: string
  department?: string | null
  lineType: string
  plannedAmount?: number
  forecastAmount?: number | null
  costModelKey?: string | null
}

export interface BudgetLineUpdateChange {
  fieldChanges: Record<string, { from: unknown; to: unknown }>
}

export interface BudgetLineDeleteChange {
  /** Snapshot of the existing row pre-delete (for audit trail). */
  snapshot: Record<string, unknown>
}

export interface BudgetActualCreateChange {
  category: string
  department?: string | null
  lineType: string
  actualAmount: number
  expenseDate?: string | null
  description?: string | null
}

export interface BudgetActualUpdateChange {
  fieldChanges: Record<string, { from: unknown; to: unknown }>
}

export interface BudgetActualDeleteChange {
  snapshot: Record<string, unknown>
}

export interface PeriodUnlockChange {
  /** Period to unlock. Format: "YYYY" / "YYYY-Q[1-4]" / "YYYY-MM". */
  period: string
}

/**
 * Discriminated-union helper — narrows `proposedChange` based on
 * the `requestType` enum. Throws on shape mismatch (the route
 * handler should never produce mismatched data; throw is a
 * defensive runtime brake).
 */
export type ProposedChangeFor<T extends ApprovalRequestType> =
  T extends "budget_line_create" ? BudgetLineCreateChange :
  T extends "budget_line_update" ? BudgetLineUpdateChange :
  T extends "budget_line_delete" ? BudgetLineDeleteChange :
  T extends "budget_actual_create" ? BudgetActualCreateChange :
  T extends "budget_actual_update" ? BudgetActualUpdateChange :
  T extends "budget_actual_delete" ? BudgetActualDeleteChange :
  T extends "period_unlock" ? PeriodUnlockChange :
  never

/**
 * Loose runtime guard — does the Json blob look like a valid change
 * shape for the given type? Returns true on shape match, false on
 * mismatch. Caller treats false as "malformed request, reject".
 */
/**
 * Phase 7.G Turn LXXII (Phase 4.3 mutation-route bypass).
 *
 * Resolves an `approvalRequestId` query param at a mutation route and
 * checks if the request is valid to bypass the 403/423 gate for THIS
 * specific mutation attempt.
 *
 * Returns:
 *   - `null` if the request can't be used (not found, wrong status, wrong
 *     type, wrong target, wrong requester, already-applied, cross-tenant,
 *     wrong planId).
 *     Caller falls through to the normal 403/423 gate.
 *   - The `ApprovalRequest` row if it validates and can be used. Caller
 *     MUST then call `claimApprovalRequest()` (atomic conditional update)
 *     BEFORE running the mutation — protects against concurrent
 *     double-apply (TOCTOU between consume and mark).
 *
 * Validation contract:
 *   - Request belongs to caller's org
 *   - status === "approved"
 *   - requestType matches `expectedType` (the mutation operation)
 *   - For update/delete: targetId matches the URL param (caller passes it)
 *   - For create types with plan scope: planId matches the mutation's plan
 *     (prevents scope-leak — admin approves change for Plan A, user can't
 *     redirect to Plan B). Filed Turn LXXII architect ⚠️ #1.
 *   - requestedBy === current userId (only the original requester can use
 *     their own approval — prevents "user A approves, user B sneaks in")
 *   - appliedAt is null (one-shot — already-applied requests can't be
 *     reused for another mutation)
 *
 * Strict requester-gating is the v1 trust model. Multi-user use (B sees
 * A's approval and acts on it) would need an explicit "delegate" enum
 * and is filed for v2 if a customer asks.
 */
export interface ConsumeApprovalRequestOpts {
  expectedType: ApprovalRequestType
  /** For *_update / *_delete requests — required to match request.targetId. */
  expectedTargetId?: string | null
  /** For *_create / period_unlock — when the request is plan-scoped, the
   *  mutation MUST target the same plan. Pass `resolvedPlanId` from the
   *  route. Skip (undefined) for routes where the request is not plan-scoped. */
  expectedPlanId?: string | null
}

export async function consumeApprovalRequest(
  prisma: Pick<PrismaClient, "approvalRequest">,
  opts: {
    requestId: string
    orgId: string
    userId: string
    expectedType: ApprovalRequestType
    expectedTargetId?: string | null
    expectedPlanId?: string | null
  },
): Promise<ApprovalRequest | null> {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: opts.requestId, organizationId: opts.orgId },
  })
  if (!request) return null
  if (request.status !== "approved") return null
  if (request.requestType !== opts.expectedType) return null
  if (request.requestedBy !== opts.userId) return null
  if (request.appliedAt !== null) return null
  if (opts.expectedTargetId != null && request.targetId !== opts.expectedTargetId) return null
  // planId scope-check — only enforce when caller passes expectedPlanId AND
  // the request itself was plan-scoped at create-time (period_unlock skips
  // both). This means: if request.planId is null OR opts.expectedPlanId is
  // null, no check. If both present, they MUST match.
  if (
    opts.expectedPlanId != null &&
    request.planId != null &&
    request.planId !== opts.expectedPlanId
  ) {
    return null
  }
  return request
}

/**
 * Atomic claim — conditional update with `appliedAt: null` precondition.
 * Returns true if THIS caller successfully claimed the approval (count===1),
 * false if another caller beat us to it (count===0). Closes the TOCTOU
 * race in Turn LXXII architect ⚠️ #2: previously consume(read) + mark
 * (post-mutation write) were non-atomic, allowing 2 concurrent requests
 * with the same id to both pass the `appliedAt===null` check and both
 * succeed → doubled mutation.
 *
 * Caller pattern:
 *   const req = await consumeApprovalRequest(...)        // shape check
 *   if (req) {
 *     const claimed = await claimApprovalRequest(...)    // atomic stamp
 *     if (!claimed) return 409 Conflict                  // lost the race
 *     // proceed with mutation; approval already marked applied
 *   }
 *
 * If the mutation later fails, the approval is "spent" — caller files a
 * new request. Trade-off accepted vs the security risk of double-apply.
 */
export async function claimApprovalRequest(
  prisma: Pick<PrismaClient, "approvalRequest">,
  requestId: string,
): Promise<boolean> {
  const result = await prisma.approvalRequest.updateMany({
    where: { id: requestId, appliedAt: null },
    data: { appliedAt: new Date() },
  })
  return result.count === 1
}

/**
 * @deprecated Turn LXXII architect ⚠️ #2 closure: superseded by
 * `claimApprovalRequest` (atomic). Kept as a thin wrapper for callers
 * that don't need the race-protection guarantee (e.g. period_unlock
 * apply path which has org-level row-lock through the Organization
 * update). New routes MUST use `claimApprovalRequest`.
 */
export async function markApprovalRequestApplied(
  prisma: Pick<PrismaClient, "approvalRequest">,
  requestId: string,
): Promise<void> {
  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { appliedAt: new Date() },
  })
}

export function isValidProposedChange(
  type: ApprovalRequestType,
  raw: unknown,
): boolean {
  if (!raw || typeof raw !== "object") return false
  const obj = raw as Record<string, unknown>
  switch (type) {
    case "budget_line_create":
      return typeof obj.category === "string" && typeof obj.lineType === "string"
    case "budget_actual_create":
      return (
        typeof obj.category === "string" &&
        typeof obj.lineType === "string" &&
        typeof obj.actualAmount === "number"
      )
    case "budget_line_update":
    case "budget_actual_update":
      return obj.fieldChanges != null && typeof obj.fieldChanges === "object"
    case "budget_line_delete":
    case "budget_actual_delete":
      return obj.snapshot != null && typeof obj.snapshot === "object"
    case "period_unlock":
      // Same regex used by /api/budgeting/period-locks (Turn LXX).
      return typeof obj.period === "string" && /^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/.test(obj.period)
    default:
      return false
  }
}
