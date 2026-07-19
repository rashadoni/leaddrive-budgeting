import { describe, expect, it } from "vitest"
import {
  evaluateStatementControl,
  type StatementReconciliationPolicy,
} from "./statement-reconciliation"
import {
  StatementControlBuilderError,
  buildBalanceSheetControl,
  buildCashFlowSumControl,
  buildCashToBalanceSheetControl,
  buildFxTranslationControl,
  buildNetIncomeLinkControl,
  buildRetainedEarningsControl,
  type FxRecomputedTerm,
  type StatementComponent,
  type StatementComponentEvidence,
  type StatementComponentRole,
  type StatementControlScope,
} from "./statement-control-builders"

// A test-only policy. There is deliberately no default/exported policy: T-1 is
// a proposal, not owner-approved, so decision eligibility here is fixture-driven.
const APPROVED_POLICY: StatementReconciliationPolicy = {
  id: "builders-test-policy-v1",
  approval: "approved",
  relativeTolerance: 0.00001,
  absoluteFloorByCurrency: { AZN: 1, USD: 0.01 },
  materialityRate: 0.001,
  materialityFloorByCurrency: { AZN: 10_000, USD: 5_000 },
}

const SCOPE: StatementControlScope = {
  organizationId: "org-1",
  companyId: "company-1",
  periodKey: "2026",
  basis: "actual",
  currency: "AZN",
  unit: "currency",
}

const OPENING_PERIOD = "2025"

function evidence(
  over: Partial<StatementComponentEvidence> = {},
): StatementComponentEvidence {
  return { value: 0, sourceRowCount: 1, revisionId: "rev-2026", ...over }
}

function component(
  name: string,
  value: number,
  role: StatementComponentRole,
  over: Partial<StatementComponent> = {},
  evidenceOver: Partial<StatementComponentEvidence> = {},
): StatementComponent {
  return {
    component: name,
    organizationId: SCOPE.organizationId,
    companyId: SCOPE.companyId,
    periodKey: role === "opening" ? OPENING_PERIOD : SCOPE.periodKey,
    basis: SCOPE.basis,
    currency: SCOPE.currency,
    unit: SCOPE.unit,
    role,
    evidence: evidence({ value, ...evidenceOver }),
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 1. Exact equations for all five builders, proven end-to-end via the evaluator
// ---------------------------------------------------------------------------

describe("statement-control-builders — exact equations", () => {
  it("balance_sheet: assets = liabilities + equity", () => {
    const input = buildBalanceSheetControl(SCOPE, {
      assets: component("assets", 1_000, "closing"),
      liabilities: component("liabilities", 400, "closing"),
      equity: component("equity", 600, "closing"),
    })
    expect(input.code).toBe("balance_sheet")
    expect(input.left.value).toBe(1_000)
    expect(input.right.value).toBe(1_000)
    const result = evaluateStatementControl(input, APPROVED_POLICY)
    expect(result).toMatchObject({
      signedDelta: 0,
      numericStatus: "within_tolerance",
      decisionStatus: "pass",
      decisionEligible: true,
    })
  })

  it("cash_flow_sum: CFO + CFI + CFF = net change in cash", () => {
    const input = buildCashFlowSumControl(SCOPE, {
      operating: component("operating", 900, "flow"),
      investing: component("investing", -500, "flow"),
      financing: component("financing", -200, "flow"),
      netChangeInCash: component("net_change_in_cash", 200, "flow"),
    })
    expect(input.left.value).toBe(200)
    expect(input.right.value).toBe(200)
    expect(evaluateStatementControl(input, APPROVED_POLICY).decisionStatus).toBe("pass")
  })

  it("cash_to_balance_sheet: opening cash + net change = balance-sheet cash", () => {
    const input = buildCashToBalanceSheetControl(SCOPE, OPENING_PERIOD, {
      openingCash: component("opening_cash", 300, "opening"),
      netChangeInCash: component("net_change_in_cash", 200, "flow"),
      balanceSheetCash: component("balance_sheet_cash", 500, "closing"),
    })
    expect(input.left.value).toBe(500)
    expect(input.right.value).toBe(500)
    // The assembled left side speaks for the control (closing) period, even
    // though it consumes an opening-period figure.
    expect(input.left.periodKey).toBe(SCOPE.periodKey)
    expect(evaluateStatementControl(input, APPROVED_POLICY).decisionStatus).toBe("pass")
  })

  it("retained_earnings: opening + net income − distributions + adjustments = closing", () => {
    const input = buildRetainedEarningsControl(SCOPE, OPENING_PERIOD, {
      openingRetainedEarnings: component("opening_retained_earnings", 1_000, "opening"),
      netIncome: component("net_income", 300, "flow"),
      distributions: component("distributions", 100, "flow"),
      directAdjustments: component("direct_adjustments", 0, "flow", {}, { evidencedZero: true, sourceRowCount: 0 }),
      closingRetainedEarnings: component("closing_retained_earnings", 1_200, "closing"),
    })
    expect(input.left.value).toBe(1_200)
    expect(input.right.value).toBe(1_200)
    expect(evaluateStatementControl(input, APPROVED_POLICY).decisionStatus).toBe("pass")
  })

  it("retained_earnings: a real direct adjustment is added into the roll-forward", () => {
    const input = buildRetainedEarningsControl(SCOPE, OPENING_PERIOD, {
      openingRetainedEarnings: component("opening_retained_earnings", 1_000, "opening"),
      netIncome: component("net_income", 300, "flow"),
      distributions: component("distributions", 100, "flow"),
      directAdjustments: component("direct_adjustments", 25, "flow"),
      closingRetainedEarnings: component("closing_retained_earnings", 1_225, "closing"),
    })
    expect(input.left.value).toBe(1_225)
    expect(evaluateStatementControl(input, APPROVED_POLICY).decisionStatus).toBe("pass")
  })

  it("net_income_link: P&L net income = the named linked-statement value", () => {
    const input = buildNetIncomeLinkControl(SCOPE, {
      pnlNetIncome: component("pnl_net_income", 300, "flow"),
      linkedStatementNetIncome: component("equity_statement_net_income", 300, "flow"),
    })
    expect(input.left.label).toBe("pnl_net_income")
    expect(input.right.label).toBe("linked_statement_net_income")
    expect(input.left.value).toBe(300)
    expect(input.right.value).toBe(300)
    expect(evaluateStatementControl(input, APPROVED_POLICY).decisionStatus).toBe("pass")
  })
})

// ---------------------------------------------------------------------------
// 2. Sign convention is never silently inverted
// ---------------------------------------------------------------------------

describe("statement-control-builders — signs are not silently inverted", () => {
  it("keeps negative cash-flow sections negative in the sum", () => {
    const input = buildCashFlowSumControl(SCOPE, {
      operating: component("operating", 1_000, "flow"),
      investing: component("investing", -800, "flow"),
      financing: component("financing", -150, "flow"),
      netChangeInCash: component("net_change_in_cash", 50, "flow"),
    })
    // If any section had been abs()'d the sum would be 1_950, not 50.
    expect(input.left.value).toBe(50)
  })

  it("subtracts distributions as passed — a negative distribution raises RE", () => {
    const input = buildRetainedEarningsControl(SCOPE, OPENING_PERIOD, {
      openingRetainedEarnings: component("opening_retained_earnings", 1_000, "opening"),
      netIncome: component("net_income", 300, "flow"),
      // A capital contribution, expressed as a negative distribution.
      distributions: component("distributions", -50, "flow"),
      directAdjustments: component("direct_adjustments", 0, "flow", {}, { evidencedZero: true, sourceRowCount: 0 }),
      closingRetainedEarnings: component("closing_retained_earnings", 1_350, "closing"),
    })
    // 1000 + 300 − (−50) = 1350, not 1000 + 300 − 50 = 1250.
    expect(input.left.value).toBe(1_350)
    expect(evaluateStatementControl(input, APPROVED_POLICY).decisionStatus).toBe("pass")
  })
})

// ---------------------------------------------------------------------------
// 3. Opening and closing periods cannot be mixed
// ---------------------------------------------------------------------------

describe("statement-control-builders — opening/closing cannot be mixed", () => {
  it("rejects a closing figure supplied in the opening slot", () => {
    expect(() =>
      buildCashToBalanceSheetControl(SCOPE, OPENING_PERIOD, {
        openingCash: component("opening_cash", 300, "closing"), // wrong role
        netChangeInCash: component("net_change_in_cash", 200, "flow"),
        balanceSheetCash: component("balance_sheet_cash", 500, "closing"),
      }),
    ).toThrow(StatementControlBuilderError)
  })

  it("rejects an opening period equal to the control period", () => {
    expect(() =>
      buildRetainedEarningsControl(SCOPE, SCOPE.periodKey, {
        openingRetainedEarnings: component("opening_retained_earnings", 1_000, "opening", {
          periodKey: SCOPE.periodKey,
        }),
        netIncome: component("net_income", 300, "flow"),
        distributions: component("distributions", 100, "flow"),
        directAdjustments: component("direct_adjustments", 0, "flow", {}, { evidencedZero: true, sourceRowCount: 0 }),
        closingRetainedEarnings: component("closing_retained_earnings", 1_200, "closing"),
      }),
    ).toThrow(/opening/i)
  })

  it("rejects an opening figure whose period is not the declared opening period", () => {
    let caught: unknown
    try {
      buildCashToBalanceSheetControl(SCOPE, OPENING_PERIOD, {
        openingCash: component("opening_cash", 300, "opening", { periodKey: "2024" }),
        netChangeInCash: component("net_change_in_cash", 200, "flow"),
        balanceSheetCash: component("balance_sheet_cash", 500, "closing"),
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StatementControlBuilderError)
    expect((caught as StatementControlBuilderError).code).toBe("period_role_mismatch")
  })

  it("rejects a flow figure carrying the wrong period", () => {
    expect(() =>
      buildCashFlowSumControl(SCOPE, {
        operating: component("operating", 900, "flow", { periodKey: "2025" }),
        investing: component("investing", -500, "flow"),
        financing: component("financing", -200, "flow"),
        netChangeInCash: component("net_change_in_cash", 200, "flow"),
      }),
    ).toThrow(StatementControlBuilderError)
  })
})

// ---------------------------------------------------------------------------
// 4. Scope mismatches are rejected deterministically by the builder
// ---------------------------------------------------------------------------

describe("statement-control-builders — scope mismatches are rejected", () => {
  const cases: Array<[string, Partial<StatementComponent>]> = [
    ["organization", { organizationId: "org-2" }],
    ["company", { companyId: "company-2" }],
    ["basis", { basis: "plan" }],
    ["currency", { currency: "USD" }],
    ["unit", { unit: "thousands" }],
  ]

  it.each(cases)("rejects a %s mismatch on a component", (_label, over) => {
    let caught: unknown
    try {
      buildBalanceSheetControl(SCOPE, {
        assets: component("assets", 1_000, "closing"),
        liabilities: component("liabilities", 400, "closing", over),
        equity: component("equity", 600, "closing"),
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StatementControlBuilderError)
    expect((caught as StatementControlBuilderError).code).toBe("scope_component_mismatch")
  })

  it("accepts a same-currency component written in a different case", () => {
    const input = buildBalanceSheetControl(SCOPE, {
      assets: component("assets", 1_000, "closing"),
      liabilities: component("liabilities", 400, "closing", { currency: "azn" }),
      equity: component("equity", 600, "closing"),
    })
    // Stamped with the canonical scope currency, so the evaluator still ties out.
    expect(input.right.currency).toBe("AZN")
    expect(evaluateStatementControl(input, APPROVED_POLICY).decisionStatus).toBe("pass")
  })
})

// ---------------------------------------------------------------------------
// 5. Source-row counts and revision lineage are propagated, never fabricated
// ---------------------------------------------------------------------------

describe("statement-control-builders — lineage propagation", () => {
  it("sums source rows and carries a unanimous revision id", () => {
    const input = buildBalanceSheetControl(SCOPE, {
      assets: component("assets", 1_000, "closing", {}, { sourceRowCount: 3, revisionId: "rev-A" }),
      liabilities: component("liabilities", 400, "closing", {}, { sourceRowCount: 2, revisionId: "rev-A" }),
      equity: component("equity", 600, "closing", {}, { sourceRowCount: 4, revisionId: "rev-A" }),
    })
    expect(input.left.sourceRowCount).toBe(3)
    expect(input.left.revisionId).toBe("rev-A")
    expect(input.right.sourceRowCount).toBe(6) // 2 + 4
    expect(input.right.revisionId).toBe("rev-A")
  })

  it("nulls a side's revision when its components disagree, keeping it provisional", () => {
    const input = buildBalanceSheetControl(SCOPE, {
      assets: component("assets", 1_000, "closing"),
      liabilities: component("liabilities", 400, "closing", {}, { revisionId: "rev-A" }),
      equity: component("equity", 600, "closing", {}, { revisionId: "rev-B" }),
    })
    expect(input.right.revisionId).toBeNull()
    const result = evaluateStatementControl(input, APPROVED_POLICY)
    expect(result.numericStatus).toBe("within_tolerance")
    expect(result.decisionStatus).toBe("provisional")
    expect(result.reasons).toContain("lineage_missing")
  })

  it("nulls a side's revision when any component is untraced", () => {
    const input = buildBalanceSheetControl(SCOPE, {
      assets: component("assets", 1_000, "closing", {}, { revisionId: null }),
      liabilities: component("liabilities", 400, "closing"),
      equity: component("equity", 600, "closing"),
    })
    expect(input.left.revisionId).toBeNull()
    expect(evaluateStatementControl(input, APPROVED_POLICY).decisionStatus).toBe("provisional")
  })

  it("rejects a real figure that claims a value with no source rows", () => {
    let caught: unknown
    try {
      buildBalanceSheetControl(SCOPE, {
        assets: component("assets", 1_000, "closing", {}, { sourceRowCount: 0 }),
        liabilities: component("liabilities", 400, "closing"),
        equity: component("equity", 600, "closing"),
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StatementControlBuilderError)
    expect((caught as StatementControlBuilderError).code).toBe("source_rows_invalid")
  })
})

// ---------------------------------------------------------------------------
// 6. Absent component is missing evidence, not a silent zero
// ---------------------------------------------------------------------------

describe("statement-control-builders — absent ≠ zero", () => {
  it("blocks the control when a component is absent, without fabricating a zero", () => {
    const input = buildRetainedEarningsControl(SCOPE, OPENING_PERIOD, {
      openingRetainedEarnings: component("opening_retained_earnings", 1_000, "opening"),
      netIncome: component("net_income", 300, "flow"),
      distributions: component("distributions", 100, "flow"),
      // Adjustments unknown — evidence absent, NOT an evidenced zero.
      directAdjustments: component("direct_adjustments", 0, "flow", { evidence: null }),
      closingRetainedEarnings: component("closing_retained_earnings", 1_200, "closing"),
    })
    expect(Number.isNaN(input.left.value)).toBe(true)
    expect(input.left.sourceRowCount).toBe(0)
    const result = evaluateStatementControl(input, APPROVED_POLICY)
    expect(result.numericStatus).toBe("not_evaluated")
    expect(result.decisionStatus).toBe("blocked")
    expect(result.reasons).toContain("source_rows_missing")
  })

  it("treats an evidenced zero as a real, traced zero that still ties out", () => {
    const input = buildRetainedEarningsControl(SCOPE, OPENING_PERIOD, {
      openingRetainedEarnings: component("opening_retained_earnings", 1_000, "opening"),
      netIncome: component("net_income", 300, "flow"),
      // Evidenced: verified that no distributions were made this period.
      distributions: component("distributions", 0, "flow", {}, { evidencedZero: true, sourceRowCount: 0 }),
      directAdjustments: component("direct_adjustments", 0, "flow", {}, { evidencedZero: true, sourceRowCount: 0 }),
      closingRetainedEarnings: component("closing_retained_earnings", 1_300, "closing"),
    })
    expect(input.left.value).toBe(1_300)
    expect(evaluateStatementControl(input, APPROVED_POLICY).decisionStatus).toBe("pass")
  })
})

// ---------------------------------------------------------------------------
// 6b. A built control still surfaces a sign inversion through the evaluator
// ---------------------------------------------------------------------------

describe("statement-control-builders — sign inversion flows through to a fail", () => {
  it("net_income_link with opposite-sign sides fails as a sign inversion", () => {
    const input = buildNetIncomeLinkControl(SCOPE, {
      pnlNetIncome: component("pnl_net_income", 0.4, "flow"),
      linkedStatementNetIncome: component("equity_statement_net_income", -0.4, "flow"),
    })
    const result = evaluateStatementControl(input, APPROVED_POLICY)
    expect(result.numericStatus).toBe("outside_tolerance")
    expect(result.decisionStatus).toBe("fail")
    expect(result.reasons).toContain("sign_inversion")
  })
})

// ---------------------------------------------------------------------------
// 6c. fx_translation — independent-rate recompute per source currency
// ---------------------------------------------------------------------------

function fxTerm(over: Partial<FxRecomputedTerm> = {}): FxRecomputedTerm {
  return { localAmount: 1_000, rate: 1.7, sourceRowCount: 1, revisionId: "rev-fx", ...over }
}

describe("statement-control-builders — fx_translation", () => {
  it("passes when the reported base equals the independent recompute", () => {
    const input = buildFxTranslationControl(SCOPE, "USD", "closing", {
      reportedBase: component("reported_base_USD", 1_700, "closing"),
      recomputed: [fxTerm({ localAmount: 1_000, rate: 1.7 })],
    })
    expect(input.code).toBe("fx_translation")
    expect(input.right.value).toBeCloseTo(1_700) // 1000 * 1.7
    const result = evaluateStatementControl(input, APPROVED_POLICY)
    expect(result.numericStatus).toBe("within_tolerance")
    expect(result.decisionStatus).toBe("pass")
    expect(result.decisionEligible).toBe(true)
  })

  it("catches a uniform wrong rate the AZN-vs-AZN controls cannot see", () => {
    // Ledger translated 1,000,000 USD at a wrong 1.9; independent rate is 1.7.
    const input = buildFxTranslationControl(SCOPE, "USD", "closing", {
      reportedBase: component("reported_base_USD", 1_900_000, "closing"),
      recomputed: [fxTerm({ localAmount: 1_000_000, rate: 1.7 })],
    })
    expect(input.right.value).toBeCloseTo(1_700_000)
    const result = evaluateStatementControl(input, APPROVED_POLICY)
    expect(result.signedDelta).toBeCloseTo(200_000)
    expect(result.numericStatus).toBe("outside_tolerance")
    expect(result.decisionStatus).toBe("fail")
    expect(result.material).toBe(true)
  })

  it("sums multiple same-currency rows and propagates unanimous revision lineage", () => {
    const input = buildFxTranslationControl(SCOPE, "USD", "closing", {
      reportedBase: component("reported_base_USD", 1_700, "closing", {}, { revisionId: "rev-A" }),
      recomputed: [
        fxTerm({ localAmount: 600, rate: 1.7, sourceRowCount: 2, revisionId: "rev-A" }),
        fxTerm({ localAmount: 400, rate: 1.7, sourceRowCount: 3, revisionId: "rev-A" }),
      ],
    })
    expect(input.right.value).toBeCloseTo(1_700) // (600 + 400) * 1.7
    expect(input.right.sourceRowCount).toBe(5)
    expect(input.right.revisionId).toBe("rev-A")
    expect(evaluateStatementControl(input, APPROVED_POLICY).decisionStatus).toBe("pass")
  })

  it("nulls the recompute revision when rows disagree, staying provisional", () => {
    const input = buildFxTranslationControl(SCOPE, "USD", "closing", {
      reportedBase: component("reported_base_USD", 1_700, "closing"),
      recomputed: [
        fxTerm({ localAmount: 600, rate: 1.7, revisionId: "rev-A" }),
        fxTerm({ localAmount: 400, rate: 1.7, revisionId: "rev-B" }),
      ],
    })
    expect(input.right.revisionId).toBeNull()
    const result = evaluateStatementControl(input, APPROVED_POLICY)
    expect(result.numericStatus).toBe("within_tolerance")
    expect(result.decisionStatus).toBe("provisional")
    expect(result.reasons).toContain("lineage_missing")
  })

  it("blocks an absent local amount or rate instead of treating it as zero", () => {
    const missingLocal = buildFxTranslationControl(SCOPE, "USD", "closing", {
      reportedBase: component("reported_base_USD", 1_700, "closing"),
      recomputed: [fxTerm({ localAmount: null })],
    })
    expect(Number.isNaN(missingLocal.right.value)).toBe(true)
    expect(missingLocal.right.sourceRowCount).toBe(0)
    const r1 = evaluateStatementControl(missingLocal, APPROVED_POLICY)
    expect(r1.decisionStatus).toBe("blocked")
    expect(r1.reasons).toContain("source_rows_missing")

    const missingRate = buildFxTranslationControl(SCOPE, "USD", "closing", {
      reportedBase: component("reported_base_USD", 1_700, "closing"),
      recomputed: [fxTerm({ rate: null })],
    })
    expect(evaluateStatementControl(missingRate, APPROVED_POLICY).decisionStatus).toBe("blocked")
  })

  it("treats an evidenced-zero position as a real, traced zero that does not block", () => {
    const input = buildFxTranslationControl(SCOPE, "USD", "closing", {
      reportedBase: component("reported_base_USD", 1_700, "closing"),
      recomputed: [
        fxTerm({ localAmount: 1_000, rate: 1.7 }),
        { localAmount: null, rate: null, sourceRowCount: 0, revisionId: "rev-fx", evidencedZero: true },
      ],
    })
    expect(Number.isFinite(input.right.value)).toBe(true)
    expect(input.right.value).toBeCloseTo(1_700)
    expect(evaluateStatementControl(input, APPROVED_POLICY).decisionStatus).toBe("pass")
  })

  it("keeps the natural sign — a negative liability recomputes to a negative base", () => {
    const input = buildFxTranslationControl(SCOPE, "USD", "closing", {
      reportedBase: component("reported_base_USD", -1_700, "closing"),
      recomputed: [fxTerm({ localAmount: -1_000, rate: 1.7 })],
    })
    expect(input.right.value).toBeCloseTo(-1_700)
    const result = evaluateStatementControl(input, APPROVED_POLICY)
    expect(result.reasons).not.toContain("sign_inversion")
    expect(result.decisionStatus).toBe("pass")
  })

  it("surfaces a sign inversion when a positive local faces a negative reported figure", () => {
    const input = buildFxTranslationControl(SCOPE, "USD", "closing", {
      reportedBase: component("reported_base_USD", -1_700, "closing"),
      recomputed: [fxTerm({ localAmount: 1_000, rate: 1.7 })],
    })
    const result = evaluateStatementControl(input, APPROVED_POLICY)
    expect(result.reasons).toContain("sign_inversion")
    expect(result.decisionStatus).toBe("fail")
  })

  it("rejects a non-positive or non-finite rate deterministically", () => {
    for (const bad of [0, -1.7, Number.POSITIVE_INFINITY, Number.NaN]) {
      let caught: unknown
      try {
        buildFxTranslationControl(SCOPE, "USD", "closing", {
          reportedBase: component("reported_base_USD", 1_700, "closing"),
          recomputed: [fxTerm({ rate: bad })],
        })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(StatementControlBuilderError)
      expect((caught as StatementControlBuilderError).code).toBe("fx_rate_invalid")
    }
  })

  it("rejects a source currency equal to the base currency", () => {
    let caught: unknown
    try {
      buildFxTranslationControl(SCOPE, "AZN", "closing", {
        reportedBase: component("reported_base_AZN", 1_700, "closing"),
        recomputed: [fxTerm()],
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StatementControlBuilderError)
    expect((caught as StatementControlBuilderError).code).toBe("source_currency_not_distinct")
  })

  it("rejects a reported figure that is not in the base currency", () => {
    let caught: unknown
    try {
      buildFxTranslationControl(SCOPE, "USD", "closing", {
        reportedBase: component("reported_base_USD", 1_700, "closing", { currency: "USD" }),
        recomputed: [fxTerm()],
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StatementControlBuilderError)
    expect((caught as StatementControlBuilderError).code).toBe("scope_component_mismatch")
  })
})

// ---------------------------------------------------------------------------
// 7. Determinism / no I/O
// ---------------------------------------------------------------------------

describe("statement-control-builders — deterministic", () => {
  it("produces byte-identical output for identical input across repeated calls", () => {
    const build = () =>
      buildCashToBalanceSheetControl(SCOPE, OPENING_PERIOD, {
        openingCash: component("opening_cash", 300, "opening"),
        netChangeInCash: component("net_change_in_cash", 200, "flow"),
        balanceSheetCash: component("balance_sheet_cash", 500, "closing"),
      })
    expect(build()).toEqual(build())
  })

  it("does not read the clock: output is independent of when it runs", () => {
    const first = buildNetIncomeLinkControl(SCOPE, {
      pnlNetIncome: component("pnl_net_income", 300, "flow"),
      linkedStatementNetIncome: component("cf_net_income", 300, "flow"),
    })
    const second = buildNetIncomeLinkControl(SCOPE, {
      pnlNetIncome: component("pnl_net_income", 300, "flow"),
      linkedStatementNetIncome: component("cf_net_income", 300, "flow"),
    })
    expect(first).toEqual(second)
  })
})
