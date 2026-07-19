/**
 * Phase 10 / B1.2 preparatory contract — pure statement-control builders.
 *
 * These builders assemble the two sides of each canonical statement control
 * from explicit, individually-scoped components, then hand a
 * `StatementControlInput` to the existing `evaluateStatementControl` evaluator.
 * They deliberately own NO tolerance, materiality, decision-status or reason
 * logic — that all lives in `statement-reconciliation.ts` — and they encode NO
 * T-1 policy. Everything here is pure: no I/O, no clock, no randomness, no
 * database, no default policy and no runtime caller.
 *
 * The five controls (03-DATA-KPI-TRUST-SPEC §3.5):
 *   1. balance_sheet          assets = liabilities + equity
 *   2. cash_flow_sum          CFO + CFI + CFF = net change in cash
 *   3. cash_to_balance_sheet  opening cash + net change = balance-sheet cash
 *   4. retained_earnings      opening RE + net income − distributions
 *                               + direct adjustments = closing RE
 *   5. net_income_link        P&L net income = linked-statement net income
 *
 * Design decisions worth a reviewer's eye:
 *
 * - **The control period is the single scope.** Every assembled side is stamped
 *   with the declared control period, so the evaluator sees matching
 *   `periodKey` on both sides. `role` ("opening" | "closing" | "flow") captures
 *   the within-statement temporal role WITHOUT changing `periodKey`: an
 *   "opening balance" line item is part of the current statement even though it
 *   represents a prior instant. Opening components carry an explicit, distinct
 *   `openingPeriodKey` and are validated against it, so a two-year-old opening
 *   balance cannot masquerade as this period's opening.
 *
 * - **Sign convention is never silently corrected.** Cash-flow sections and the
 *   net change are passed with their natural sign (outflows negative) and summed
 *   as given. Distributions are SUBTRACTED as passed: a positive value reduces
 *   retained earnings, a negative value (a contribution) increases it. No
 *   builder applies `abs()` or a sign flip.
 *
 * - **Absent ≠ zero.** A component with `evidence: null` is missing evidence,
 *   not a silent zero. A side containing a missing component is stamped
 *   non-finite with zero source rows so the evaluator BLOCKS it; the value is
 *   never fabricated as 0. To assert a genuine zero (e.g. "no distributions this
 *   period"), pass an `evidencedZero` component.
 *
 * - **Lineage is propagated, never fabricated.** A side's `sourceRowCount` is
 *   the sum of its components' counts and its `revisionId` is the components'
 *   unanimous non-null revision, or null when they disagree or any is untraced.
 *   A single revision id is never invented for a side that does not have one.
 */

import type {
  StatementControlInput,
  StatementControlSide,
} from "./statement-reconciliation"

/** Basis reused verbatim from the evaluator so the two contracts cannot drift. */
export type StatementBasis = StatementControlSide["basis"]

/** Temporal role of a component within its control's period. */
export type StatementComponentRole = "opening" | "closing" | "flow"

export interface StatementComponentEvidence {
  /** The figure, carried with its natural sign. */
  value: number
  /**
   * Number of source rows that produced this figure. A real figure needs at
   * least one; an evidenced zero (see `evidencedZero`) may have none.
   */
  sourceRowCount: number
  /** Lineage of the source revision, or null when the figure is untraced. */
  revisionId: string | null
  /**
   * Marks an intentional, evidenced zero (e.g. "no distributions this period").
   * It contributes a real 0 to the equation and may carry `sourceRowCount: 0`.
   * It is NOT the same as an absent component (`evidence: null`).
   */
  evidencedZero?: boolean
}

export interface StatementComponent {
  /** Provenance name, e.g. "assets", "operating", "net_income". */
  component: string
  organizationId: string
  companyId: string
  periodKey: string
  basis: StatementBasis
  currency: string
  unit: string
  role: StatementComponentRole
  /** null marks an absent component (missing evidence), never a silent zero. */
  evidence: StatementComponentEvidence | null
}

export interface StatementControlScope {
  organizationId: string
  companyId: string
  /** The period the control speaks for; the closing period for roll-forwards. */
  periodKey: string
  basis: StatementBasis
  currency: string
  unit: string
}

export type StatementControlBuilderErrorCode =
  | "scope_component_mismatch"
  | "component_role_mismatch"
  | "period_role_mismatch"
  | "opening_period_not_distinct"
  | "source_rows_invalid"

/**
 * Deterministic rejection for inputs that cannot be represented as a single
 * `StatementControlInput` (e.g. two currencies inside one side, or an
 * opening/closing period confusion). Scope mismatches that CAN be represented
 * are validated against the declared control scope and rejected here too, so a
 * builder either returns a scope-consistent input or throws.
 */
export class StatementControlBuilderError extends Error {
  readonly code: StatementControlBuilderErrorCode
  readonly component: string
  constructor(
    code: StatementControlBuilderErrorCode,
    component: string,
    message: string,
  ) {
    super(message)
    this.name = "StatementControlBuilderError"
    this.code = code
    this.component = component
  }
}

interface SignedTerm {
  component: StatementComponent
  sign: 1 | -1
  expectedRole: StatementComponentRole
}

/** Mirrors the evaluator's currency comparison (trim + upper). */
function normalizedCurrency(value: string): string {
  return value.trim().toUpperCase()
}

function assertTerm(
  term: SignedTerm,
  scope: StatementControlScope,
  openingPeriodKey: string | null,
): void {
  const c = term.component
  const fail = (
    code: StatementControlBuilderErrorCode,
    message: string,
  ): never => {
    throw new StatementControlBuilderError(code, c.component, message)
  }

  if (c.organizationId !== scope.organizationId) {
    fail("scope_component_mismatch", `component "${c.component}" organizationId does not match the control scope`)
  }
  if (c.companyId !== scope.companyId) {
    fail("scope_component_mismatch", `component "${c.component}" companyId does not match the control scope`)
  }
  if (c.basis !== scope.basis) {
    fail("scope_component_mismatch", `component "${c.component}" basis does not match the control scope`)
  }
  if (normalizedCurrency(c.currency) !== normalizedCurrency(scope.currency)) {
    fail("scope_component_mismatch", `component "${c.component}" currency does not match the control scope`)
  }
  if (c.unit.trim() !== scope.unit.trim()) {
    fail("scope_component_mismatch", `component "${c.component}" unit does not match the control scope`)
  }
  if (c.role !== term.expectedRole) {
    fail("component_role_mismatch", `component "${c.component}" has role "${c.role}" but this slot requires "${term.expectedRole}"`)
  }

  if (term.expectedRole === "opening") {
    if (openingPeriodKey == null || openingPeriodKey === scope.periodKey) {
      fail("opening_period_not_distinct", `component "${c.component}" is an opening figure but no distinct opening period was declared`)
    }
    if (c.periodKey !== openingPeriodKey) {
      fail("period_role_mismatch", `opening component "${c.component}" periodKey does not match the declared opening period`)
    }
  } else if (c.periodKey !== scope.periodKey) {
    fail("period_role_mismatch", `component "${c.component}" periodKey does not match the control period`)
  }
}

function assertSourceRows(component: StatementComponent): void {
  const ev = component.evidence
  if (ev == null) return // missing: handled by the incomplete-side path, not a throw
  if (ev.evidencedZero === true) {
    if (!Number.isSafeInteger(ev.sourceRowCount) || ev.sourceRowCount < 0) {
      throw new StatementControlBuilderError(
        "source_rows_invalid",
        component.component,
        `evidenced-zero component "${component.component}" has an invalid source-row count`,
      )
    }
    return
  }
  if (!Number.isSafeInteger(ev.sourceRowCount) || ev.sourceRowCount <= 0) {
    throw new StatementControlBuilderError(
      "source_rows_invalid",
      component.component,
      `component "${component.component}" claims a value but has no source rows`,
    )
  }
}

function combineSide(
  label: string,
  scope: StatementControlScope,
  terms: ReadonlyArray<SignedTerm>,
  openingPeriodKey: string | null,
): StatementControlSide {
  for (const term of terms) {
    assertTerm(term, scope, openingPeriodKey)
    assertSourceRows(term.component)
  }

  const base = {
    label,
    organizationId: scope.organizationId,
    companyId: scope.companyId,
    periodKey: scope.periodKey,
    basis: scope.basis,
    currency: scope.currency,
    unit: scope.unit,
  }

  // A missing component makes the side non-finite with zero source rows so the
  // evaluator blocks it — the value is never fabricated as 0.
  const incomplete = terms.some((t) => t.component.evidence == null)
  if (incomplete) {
    return { ...base, value: Number.NaN, sourceRowCount: 0, revisionId: null }
  }

  let value = 0
  let sourceRowCount = 0
  const revisionIds = new Set<string | null>()
  for (const term of terms) {
    const ev = term.component.evidence as StatementComponentEvidence
    value += term.sign * ev.value
    sourceRowCount += ev.sourceRowCount
    revisionIds.add(ev.revisionId)
  }

  const revisionId =
    revisionIds.size === 1 && !revisionIds.has(null)
      ? (revisionIds.values().next().value as string)
      : null

  return { ...base, value, sourceRowCount, revisionId }
}

export interface BalanceSheetControlComponents {
  assets: StatementComponent
  liabilities: StatementComponent
  equity: StatementComponent
}

/** assets = liabilities + equity (all closing-period stock). */
export function buildBalanceSheetControl(
  scope: StatementControlScope,
  components: BalanceSheetControlComponents,
): StatementControlInput {
  const left = combineSide(
    "assets",
    scope,
    [{ component: components.assets, sign: 1, expectedRole: "closing" }],
    null,
  )
  const right = combineSide(
    "liabilities+equity",
    scope,
    [
      { component: components.liabilities, sign: 1, expectedRole: "closing" },
      { component: components.equity, sign: 1, expectedRole: "closing" },
    ],
    null,
  )
  return { code: "balance_sheet", left, right }
}

export interface CashFlowSumControlComponents {
  operating: StatementComponent
  investing: StatementComponent
  financing: StatementComponent
  netChangeInCash: StatementComponent
}

/** CFO + CFI + CFF = net change in cash (all period flows, natural sign). */
export function buildCashFlowSumControl(
  scope: StatementControlScope,
  components: CashFlowSumControlComponents,
): StatementControlInput {
  const left = combineSide(
    "operating+investing+financing",
    scope,
    [
      { component: components.operating, sign: 1, expectedRole: "flow" },
      { component: components.investing, sign: 1, expectedRole: "flow" },
      { component: components.financing, sign: 1, expectedRole: "flow" },
    ],
    null,
  )
  const right = combineSide(
    "net_change_in_cash",
    scope,
    [{ component: components.netChangeInCash, sign: 1, expectedRole: "flow" }],
    null,
  )
  return { code: "cash_flow_sum", left, right }
}

export interface CashTieOutControlComponents {
  openingCash: StatementComponent
  netChangeInCash: StatementComponent
  balanceSheetCash: StatementComponent
}

/** opening cash + net change in cash = balance-sheet cash (closing tie-out). */
export function buildCashToBalanceSheetControl(
  scope: StatementControlScope,
  openingPeriodKey: string,
  components: CashTieOutControlComponents,
): StatementControlInput {
  const left = combineSide(
    "opening_cash+net_change_in_cash",
    scope,
    [
      { component: components.openingCash, sign: 1, expectedRole: "opening" },
      { component: components.netChangeInCash, sign: 1, expectedRole: "flow" },
    ],
    openingPeriodKey,
  )
  const right = combineSide(
    "balance_sheet_cash",
    scope,
    [{ component: components.balanceSheetCash, sign: 1, expectedRole: "closing" }],
    openingPeriodKey,
  )
  return { code: "cash_to_balance_sheet", left, right }
}

export interface RetainedEarningsControlComponents {
  openingRetainedEarnings: StatementComponent
  netIncome: StatementComponent
  /** Subtracted as passed; a negative value (a contribution) is not inverted. */
  distributions: StatementComponent
  /**
   * Added as passed. Existence must be explicit: pass an `evidencedZero`
   * component to assert none, a real figure to declare an adjustment, or
   * `evidence: null` to signal the adjustment is unknown (the control blocks).
   */
  directAdjustments: StatementComponent
  closingRetainedEarnings: StatementComponent
}

/** opening RE + net income − distributions + direct adjustments = closing RE. */
export function buildRetainedEarningsControl(
  scope: StatementControlScope,
  openingPeriodKey: string,
  components: RetainedEarningsControlComponents,
): StatementControlInput {
  const left = combineSide(
    "opening_retained_earnings+net_income-distributions+direct_adjustments",
    scope,
    [
      { component: components.openingRetainedEarnings, sign: 1, expectedRole: "opening" },
      { component: components.netIncome, sign: 1, expectedRole: "flow" },
      { component: components.distributions, sign: -1, expectedRole: "flow" },
      { component: components.directAdjustments, sign: 1, expectedRole: "flow" },
    ],
    openingPeriodKey,
  )
  const right = combineSide(
    "closing_retained_earnings",
    scope,
    [{ component: components.closingRetainedEarnings, sign: 1, expectedRole: "closing" }],
    openingPeriodKey,
  )
  return { code: "retained_earnings", left, right }
}

export interface NetIncomeLinkControlComponents {
  pnlNetIncome: StatementComponent
  /** The explicitly named linked-statement net-income figure and its provenance. */
  linkedStatementNetIncome: StatementComponent
}

/** P&L net income = the explicitly named linked-statement net income. */
export function buildNetIncomeLinkControl(
  scope: StatementControlScope,
  components: NetIncomeLinkControlComponents,
): StatementControlInput {
  const left = combineSide(
    "pnl_net_income",
    scope,
    [{ component: components.pnlNetIncome, sign: 1, expectedRole: "flow" }],
    null,
  )
  const right = combineSide(
    "linked_statement_net_income",
    scope,
    [{ component: components.linkedStatementNetIncome, sign: 1, expectedRole: "flow" }],
    null,
  )
  return { code: "net_income_link", left, right }
}
