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

import type { ApprovalRequestStatus, ApprovalRequestType } from "@prisma/client"

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
