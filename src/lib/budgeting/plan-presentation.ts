import type { BudgetPlan } from "./types"

export type PlanStatus = BudgetPlan["status"]

export type PlanStatusKey =
  | "statusDraft"
  | "statusPending"
  | "statusApproved"
  | "statusRejected"
  | "statusClosed"
  | "plansStatusUnknown"

const STATUS_KEYS: Record<PlanStatus, PlanStatusKey> = {
  draft: "statusDraft",
  pending_approval: "statusPending",
  approved: "statusApproved",
  rejected: "statusRejected",
  closed: "statusClosed",
}

export function planStatusKey(status: string | null | undefined): PlanStatusKey {
  return STATUS_KEYS[status as PlanStatus] ?? "plansStatusUnknown"
}

export type PlanKindKey = "plansKindActual" | "plansKindBudget" | "plansKindUnknown"

export function planKindKey(kind: BudgetPlan["kind"]): PlanKindKey {
  if (kind === "actual") return "plansKindActual"
  if (kind === "budget") return "plansKindBudget"
  return "plansKindUnknown"
}

export type PlanLineEvidence =
  | { state: "populated"; count: number }
  | { state: "empty"; count: 0 }
  | { state: "unknown"; count: null }

/** Missing count metadata is unknown evidence, never an inferred zero. */
export function planLineEvidence(plan: Pick<BudgetPlan, "_count">): PlanLineEvidence {
  const count = plan._count?.lines
  if (!Number.isInteger(count) || count == null || count < 0) {
    return { state: "unknown", count: null }
  }
  return count === 0
    ? { state: "empty", count: 0 }
    : { state: "populated", count }
}
