import { describe, expect, it } from "vitest"
import {
  STATEMENT_CONTROL_CODES,
  evaluateStatementControl,
  type StatementControlInput,
  type StatementControlSide,
  type StatementReconciliationPolicy,
} from "./statement-reconciliation"

const APPROVED_POLICY: StatementReconciliationPolicy = {
  id: "golden-test-policy-v1",
  approval: "approved",
  relativeTolerance: 0.00001,
  absoluteFloorByCurrency: { AZN: 1, USD: 0.01 },
  materialityRate: 0.001,
  materialityFloorByCurrency: { AZN: 10_000, USD: 5_000 },
}

function side(over: Partial<StatementControlSide> = {}): StatementControlSide {
  return {
    label: "left",
    value: 1_000,
    organizationId: "org-1",
    companyId: "company-1",
    periodKey: "2026",
    basis: "actual",
    currency: "AZN",
    unit: "currency",
    sourceRowCount: 10,
    revisionId: "revision-1",
    ...over,
  }
}

function control(over: Partial<StatementControlInput> = {}): StatementControlInput {
  return {
    code: "balance_sheet",
    left: side(),
    right: side({ label: "right" }),
    ...over,
  }
}

describe("evaluateStatementControl — golden reconciliation evidence", () => {
  it("covers the six required statement controls", () => {
    expect(STATEMENT_CONTROL_CODES).toEqual([
      "balance_sheet",
      "cash_flow_sum",
      "cash_to_balance_sheet",
      "retained_earnings",
      "net_income_link",
      "fx_translation",
    ])
  })

  it("returns an eligible pass for an exact, approved, traced comparison", () => {
    const result = evaluateStatementControl(control(), APPROVED_POLICY)
    expect(result).toMatchObject({
      numericStatus: "within_tolerance",
      decisionStatus: "pass",
      decisionEligible: true,
      signedDelta: 0,
      tolerance: 1,
      material: false,
      reasons: [],
    })
  })

  it("uses signed left-minus-right delta and includes the absolute boundary", () => {
    const result = evaluateStatementControl(
      control({ left: side({ value: 999 }), right: side({ label: "right", value: 1_000 }) }),
      APPROVED_POLICY,
    )
    expect(result.signedDelta).toBe(-1)
    expect(result.absoluteDelta).toBe(1)
    expect(result.numericStatus).toBe("within_tolerance")
    expect(result.decisionStatus).toBe("pass")
  })

  it("uses the relative tolerance when it is larger than the currency floor", () => {
    const result = evaluateStatementControl(
      control({
        left: side({ value: 10_000_000.5 }),
        right: side({ label: "right", value: 10_000_000 }),
      }),
      APPROVED_POLICY,
    )
    expect(result.tolerance).toBeCloseTo(100.000005)
    expect(result.numericStatus).toBe("within_tolerance")
  })

  it("fails just outside tolerance while keeping materiality separate", () => {
    const result = evaluateStatementControl(
      control({ left: side({ value: 1_001.01 }) }),
      APPROVED_POLICY,
    )
    expect(result.numericStatus).toBe("outside_tolerance")
    expect(result.decisionStatus).toBe("fail")
    expect(result.material).toBe(false)
    expect(result.materialityThreshold).toBe(10_000)
  })

  it("marks a large control failure as material for triage", () => {
    const result = evaluateStatementControl(
      control({ left: side({ value: 25_000 }), right: side({ label: "right", value: 1_000 }) }),
      APPROVED_POLICY,
    )
    expect(result.decisionStatus).toBe("fail")
    expect(result.material).toBe(true)
  })

  it("keeps an unapproved policy provisional even when arithmetic matches", () => {
    const result = evaluateStatementControl(control(), {
      ...APPROVED_POLICY,
      approval: "provisional",
    })
    expect(result.numericStatus).toBe("within_tolerance")
    expect(result.decisionStatus).toBe("provisional")
    expect(result.decisionEligible).toBe(false)
    expect(result.reasons).toContain("policy_not_approved")
  })

  it("keeps missing lineage provisional instead of returning a pass", () => {
    const result = evaluateStatementControl(
      control({ left: side({ revisionId: null }) }),
      APPROVED_POLICY,
    )
    expect(result.numericStatus).toBe("within_tolerance")
    expect(result.decisionStatus).toBe("provisional")
    expect(result.reasons).toContain("lineage_missing")
  })

  it.each([
    ["organization", { organizationId: "org-2" }, "scope_organization_mismatch"],
    ["company", { companyId: "company-2" }, "scope_company_mismatch"],
    ["period", { periodKey: "2025" }, "scope_period_mismatch"],
    ["basis", { basis: "plan" as const }, "scope_basis_mismatch"],
    ["currency", { currency: "USD" }, "currency_mismatch"],
    ["unit", { unit: "thousands" }, "unit_mismatch"],
    ["source rows", { sourceRowCount: 0 }, "source_rows_missing"],
  ])("blocks a %s mismatch before numeric evaluation", (_label, rightOver, reason) => {
    const result = evaluateStatementControl(
      control({ right: side({ label: "right", ...rightOver }) }),
      APPROVED_POLICY,
    )
    expect(result.numericStatus).toBe("not_evaluated")
    expect(result.decisionStatus).toBe("blocked")
    expect(result.signedDelta).toBeNull()
    expect(result.reasons).toContain(reason)
  })

  it("blocks a currency whose policy floors are not explicitly defined", () => {
    const result = evaluateStatementControl(
      control({
        left: side({ currency: "EUR" }),
        right: side({ label: "right", currency: "EUR" }),
      }),
      APPROVED_POLICY,
    )
    expect(result.decisionStatus).toBe("blocked")
    expect(result.reasons).toContain("policy_currency_floor_missing")
  })

  it("blocks non-finite values", () => {
    const result = evaluateStatementControl(
      control({ left: side({ value: Number.NaN }) }),
      APPROVED_POLICY,
    )
    expect(result.decisionStatus).toBe("blocked")
    expect(result.reasons).toContain("non_finite_value")
  })

  it("blocks invalid source row counts instead of treating them as lineage", () => {
    const result = evaluateStatementControl(
      control({ left: side({ sourceRowCount: 1.5 }) }),
      APPROVED_POLICY,
    )
    expect(result.decisionStatus).toBe("blocked")
    expect(result.reasons).toContain("source_rows_missing")
  })

  it("rejects invalid policy coefficients instead of silently normalizing them", () => {
    expect(() =>
      evaluateStatementControl(control(), {
        ...APPROVED_POLICY,
        relativeTolerance: -1,
      }),
    ).toThrow("relativeTolerance must be a finite non-negative number")
  })
})

describe("evaluateStatementControl — sign gate", () => {
  it("fails a sub-floor sign inversion instead of passing it", () => {
    const result = evaluateStatementControl(
      control({ left: side({ value: 0.4 }), right: side({ label: "right", value: -0.4 }) }),
      APPROVED_POLICY,
    )
    // |0.4 - (-0.4)| = 0.8 <= 1.0 floor: without the sign gate this would pass.
    expect(result.signedDelta).toBeCloseTo(0.8)
    expect(result.numericStatus).toBe("outside_tolerance")
    expect(result.decisionStatus).toBe("fail")
    expect(result.decisionEligible).toBe(true)
    expect(result.reasons).toContain("sign_inversion")
  })

  it("keeps a sign inversion out of a pass even when the policy is unapproved", () => {
    const result = evaluateStatementControl(
      control({ left: side({ value: 0.4 }), right: side({ label: "right", value: -0.4 }) }),
      { ...APPROVED_POLICY, approval: "provisional" },
    )
    expect(result.numericStatus).toBe("outside_tolerance")
    expect(result.decisionStatus).toBe("provisional")
    expect(result.reasons).toContain("sign_inversion")
    expect(result.reasons).toContain("policy_not_approved")
  })

  it("flags a large-magnitude sign inversion as a diagnostic reason and fails", () => {
    const result = evaluateStatementControl(
      control({ left: side({ value: 5_000 }), right: side({ label: "right", value: -5_000 }) }),
      APPROVED_POLICY,
    )
    expect(result.reasons).toContain("sign_inversion")
    expect(result.decisionStatus).toBe("fail")
  })

  it("does not treat a zero side as a sign inversion", () => {
    const result = evaluateStatementControl(
      control({ left: side({ value: 0.5 }), right: side({ label: "right", value: 0 }) }),
      APPROVED_POLICY,
    )
    expect(result.reasons).not.toContain("sign_inversion")
    expect(result.decisionStatus).toBe("pass")
  })

  it("does not flag two same-sign negative values", () => {
    const result = evaluateStatementControl(
      control({ left: side({ value: -1_000 }), right: side({ label: "right", value: -1_000 }) }),
      APPROVED_POLICY,
    )
    expect(result.reasons).not.toContain("sign_inversion")
    expect(result.decisionStatus).toBe("pass")
  })
})

describe("evaluateStatementControl — tolerance basis governance (condition #6)", () => {
  it("derives the basis from the two sides and cannot be widened by a caller", () => {
    const inflated: StatementControlInput = {
      code: "balance_sheet",
      left: side({ value: 1_500 }),
      right: side({ label: "right", value: 1_000 }),
      // @ts-expect-error condition #6 — the tolerance basis is never a call-site parameter
      basisAmount: 1_000_000_000,
    }
    const result = evaluateStatementControl(inflated, APPROVED_POLICY)
    // Basis comes from the sides (1,500) so the tolerance stays at the 1 AZN
    // floor. Under an inflatable basis of 1e9 the tolerance would have been
    // 10,000 and this 500 break would have silently passed — option C under an
    // "A" label.
    expect(result.basisAmount).toBe(1_500)
    expect(result.tolerance).toBe(1)
    expect(result.numericStatus).toBe("outside_tolerance")
    expect(result.decisionStatus).toBe("fail")
  })
})
