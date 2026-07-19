/**
 * Phase 10 / B1 preparatory contract — canonical statement reconciliation.
 *
 * This module is deliberately pure and has no runtime caller. It defines the
 * comparison semantics needed by the future statement mart without choosing
 * or enforcing T-1. Callers must pass an explicit policy; a provisional policy
 * can calculate evidence but can never produce a decision-grade pass/fail.
 */

export const STATEMENT_CONTROL_CODES = [
  "balance_sheet",
  "cash_flow_sum",
  "cash_to_balance_sheet",
  "retained_earnings",
  "net_income_link",
] as const

export type StatementControlCode = (typeof STATEMENT_CONTROL_CODES)[number]
export type StatementPolicyApproval = "provisional" | "approved"
export type StatementNumericStatus =
  | "within_tolerance"
  | "outside_tolerance"
  | "not_evaluated"
export type StatementDecisionStatus = "pass" | "fail" | "provisional" | "blocked"

export type StatementReconciliationReason =
  | "non_finite_value"
  | "scope_organization_mismatch"
  | "scope_company_mismatch"
  | "scope_period_mismatch"
  | "scope_basis_mismatch"
  | "currency_mismatch"
  | "unit_mismatch"
  | "source_rows_missing"
  | "policy_currency_floor_missing"
  | "policy_not_approved"
  | "lineage_missing"

export interface StatementControlSide {
  label: string
  value: number
  organizationId: string
  companyId: string
  periodKey: string
  basis: "actual" | "plan" | "forecast" | "scenario"
  currency: string
  unit: string
  sourceRowCount: number
  revisionId: string | null
}

export interface StatementControlInput {
  code: StatementControlCode
  /** Observed/derived side. Signed delta is `left.value - right.value`. */
  left: StatementControlSide
  /** Expected/control side. */
  right: StatementControlSide
  /** Optional explicit scale; otherwise max(abs(left), abs(right)). */
  basisAmount?: number
}

export interface StatementReconciliationPolicy {
  id: string
  approval: StatementPolicyApproval
  /** Decimal ratio: 0.00001 = 0.001% = 0.1 bp. */
  relativeTolerance: number
  absoluteFloorByCurrency: Readonly<Record<string, number>>
  /** Separate triage threshold; never changes pass/fail. */
  materialityRate: number
  materialityFloorByCurrency: Readonly<Record<string, number>>
}

export interface StatementControlResult {
  code: StatementControlCode
  policyId: string
  policyApproval: StatementPolicyApproval
  numericStatus: StatementNumericStatus
  decisionStatus: StatementDecisionStatus
  decisionEligible: boolean
  signedDelta: number | null
  absoluteDelta: number | null
  basisAmount: number | null
  tolerance: number | null
  materialityThreshold: number | null
  material: boolean | null
  reasons: ReadonlyArray<StatementReconciliationReason>
}

function normalizedCurrency(value: string): string {
  return value.trim().toUpperCase()
}

function policyNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`)
  }
  return value
}

function currencyFloor(
  values: Readonly<Record<string, number>>,
  currency: string,
): number | null {
  const value = values[normalizedCurrency(currency)]
  return value == null ? null : policyNumber(value, `currency floor ${currency}`)
}

function structuralReasons(input: StatementControlInput): StatementReconciliationReason[] {
  const { left, right } = input
  const reasons: StatementReconciliationReason[] = []

  if (!Number.isFinite(left.value) || !Number.isFinite(right.value)) {
    reasons.push("non_finite_value")
  }
  if (left.organizationId !== right.organizationId) {
    reasons.push("scope_organization_mismatch")
  }
  if (left.companyId !== right.companyId) {
    reasons.push("scope_company_mismatch")
  }
  if (left.periodKey !== right.periodKey) {
    reasons.push("scope_period_mismatch")
  }
  if (left.basis !== right.basis) {
    reasons.push("scope_basis_mismatch")
  }
  if (normalizedCurrency(left.currency) !== normalizedCurrency(right.currency)) {
    reasons.push("currency_mismatch")
  }
  if (left.unit.trim() !== right.unit.trim()) {
    reasons.push("unit_mismatch")
  }
  if (
    !Number.isSafeInteger(left.sourceRowCount) ||
    left.sourceRowCount <= 0 ||
    !Number.isSafeInteger(right.sourceRowCount) ||
    right.sourceRowCount <= 0
  ) {
    reasons.push("source_rows_missing")
  }

  return reasons
}

/**
 * Evaluate one statement control. Numeric evidence and decision eligibility
 * are intentionally separate: an unapproved policy or missing lineage remains
 * provisional even when the arithmetic is within tolerance.
 */
export function evaluateStatementControl(
  input: StatementControlInput,
  policy: StatementReconciliationPolicy,
): StatementControlResult {
  policyNumber(policy.relativeTolerance, "relativeTolerance")
  policyNumber(policy.materialityRate, "materialityRate")

  const reasons = structuralReasons(input)
  const currency = normalizedCurrency(input.left.currency)
  const absoluteFloor = currencyFloor(policy.absoluteFloorByCurrency, currency)
  const materialityFloor = currencyFloor(policy.materialityFloorByCurrency, currency)

  if (absoluteFloor == null || materialityFloor == null) {
    reasons.push("policy_currency_floor_missing")
  }

  if (reasons.length > 0) {
    return {
      code: input.code,
      policyId: policy.id,
      policyApproval: policy.approval,
      numericStatus: "not_evaluated",
      decisionStatus: "blocked",
      decisionEligible: false,
      signedDelta: null,
      absoluteDelta: null,
      basisAmount: null,
      tolerance: null,
      materialityThreshold: null,
      material: null,
      reasons,
    }
  }

  const signedDelta = input.left.value - input.right.value
  const absoluteDelta = Math.abs(signedDelta)
  const basisAmount = Math.abs(
    input.basisAmount ?? Math.max(Math.abs(input.left.value), Math.abs(input.right.value)),
  )
  if (!Number.isFinite(basisAmount)) {
    return {
      code: input.code,
      policyId: policy.id,
      policyApproval: policy.approval,
      numericStatus: "not_evaluated",
      decisionStatus: "blocked",
      decisionEligible: false,
      signedDelta: null,
      absoluteDelta: null,
      basisAmount: null,
      tolerance: null,
      materialityThreshold: null,
      material: null,
      reasons: ["non_finite_value"],
    }
  }

  const tolerance = Math.max(
    absoluteFloor as number,
    basisAmount * policy.relativeTolerance,
  )
  const materialityThreshold = Math.max(
    materialityFloor as number,
    basisAmount * policy.materialityRate,
  )
  const numericStatus =
    absoluteDelta <= tolerance ? "within_tolerance" : "outside_tolerance"

  if (policy.approval !== "approved") reasons.push("policy_not_approved")
  if (input.left.revisionId == null || input.right.revisionId == null) {
    reasons.push("lineage_missing")
  }

  const decisionEligible = reasons.length === 0
  return {
    code: input.code,
    policyId: policy.id,
    policyApproval: policy.approval,
    numericStatus,
    decisionStatus: decisionEligible
      ? numericStatus === "within_tolerance"
        ? "pass"
        : "fail"
      : "provisional",
    decisionEligible,
    signedDelta,
    absoluteDelta,
    basisAmount,
    tolerance,
    materialityThreshold,
    material: absoluteDelta > materialityThreshold,
    reasons,
  }
}
