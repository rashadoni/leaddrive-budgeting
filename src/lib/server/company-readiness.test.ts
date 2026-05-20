/**
 * Phase 7.M Step 5 — pure scoring fn tests.
 */
import { describe, it, expect } from "vitest"
import {
  computeCompanyReadiness,
  READINESS_WEIGHTS_SUM,
  type ReadinessInputs,
} from "./company-readiness"

const FULL: ReadinessInputs = {
  budgetLineCount: 100,
  budgetLineTypeCount: 3,
  hasBalanceSheet: true,
  customerCount: 5,
  supplierCount: 5,
  operationalFactMetricCount: 4,
  strategicNarrativeLength: 500,
  computedIndicatorCount: 20,
  hasForeignCurrencyTags: true,
}

const EMPTY: ReadinessInputs = {
  budgetLineCount: 0,
  budgetLineTypeCount: 0,
  hasBalanceSheet: false,
  customerCount: 0,
  supplierCount: 0,
  operationalFactMetricCount: 0,
  strategicNarrativeLength: 0,
  computedIndicatorCount: 0,
  hasForeignCurrencyTags: false,
}

describe("computeCompanyReadiness", () => {
  it("weights sum to 100", () => {
    expect(READINESS_WEIGHTS_SUM).toBe(100)
  })

  it("full data → 100% complete", () => {
    const r = computeCompanyReadiness(FULL)
    expect(r.score).toBe(100)
    expect(r.tier).toBe("complete")
    expect(r.areas.every((a) => a.missing === null)).toBe(true)
  })

  it("empty data → 0% empty", () => {
    const r = computeCompanyReadiness(EMPTY)
    expect(r.score).toBe(0)
    expect(r.tier).toBe("empty")
    expect(r.areas.every((a) => a.earned === 0)).toBe(true)
  })

  it("AZSEKER-AZSF profile (real-world snapshot)", () => {
    // 96 budget_lines × 3 types, has BS, 7 customers, 8 suppliers, 3 op
    // metrics, no narrative, ~22 indicators, no FX tags. Real shape
    // from the 2026-05-18 AZSEKER audit.
    const r = computeCompanyReadiness({
      budgetLineCount: 96,
      budgetLineTypeCount: 3,
      hasBalanceSheet: true,
      customerCount: 7,
      supplierCount: 8,
      operationalFactMetricCount: 3,
      strategicNarrativeLength: 0,
      computedIndicatorCount: 22,
      hasForeignCurrencyTags: false,
    })
    // P&L 25 + BS 15 + Counter 15 + Op 15 + Narr 0 + Ind 10 + FX 0 = 80
    expect(r.score).toBeGreaterThan(70)
    expect(r.score).toBeLessThan(85)
    expect(r.tier).toBe("good")
    const missingNarrative = r.areas.find((a) => a.id === "narrative")
    expect(missingNarrative?.missing).toBe("missing")
    const missingFx = r.areas.find((a) => a.id === "fxTags")
    expect(missingFx?.missing).toBe("no foreign-currency budget lines")
  })

  it("DEMO-* sector stub (level=2, zero data) lands in 'empty' tier", () => {
    const r = computeCompanyReadiness({
      ...EMPTY,
      // DEMO entities have 0 IVs computed too (their indicators are
      // all unknown post-guard fix).
      computedIndicatorCount: 0,
    })
    expect(r.tier).toBe("empty")
    expect(r.score).toBe(0)
  })

  it("partial P&L (10 lines / 1 type) earns proportional credit", () => {
    const r = computeCompanyReadiness({
      ...EMPTY,
      budgetLineCount: 10,
      budgetLineTypeCount: 1,
    })
    // P&L weight = 25; (10/50)*0.7*25 + (1/3)*0.3*25 ≈ 3.5 + 2.5 = 6
    expect(r.score).toBe(6)
    expect(r.tier).toBe("empty") // still below 15
  })

  it("counterparty subscore splits 50/50 customers vs suppliers", () => {
    const customersOnly = computeCompanyReadiness({
      ...EMPTY,
      customerCount: 5,
      supplierCount: 0,
    })
    const balanced = computeCompanyReadiness({
      ...EMPTY,
      customerCount: 3,
      supplierCount: 3,
    })
    // customersOnly: 7.5 (half weight); balanced: 15 (full weight).
    expect(balanced.score).toBeGreaterThan(customersOnly.score)
  })

  it("tier boundaries: 85=complete, 65=good, 40=partial, 15=thin, 0=empty", () => {
    expect(computeCompanyReadiness(FULL).tier).toBe("complete")
    // Drop FX tags + half indicators → ~85 → complete still.
    const dropFx = computeCompanyReadiness({
      ...FULL,
      hasForeignCurrencyTags: false,
    })
    expect(dropFx.score).toBe(90)
    expect(dropFx.tier).toBe("complete")
    // Drop FX + narrative → 80 → good.
    const dropFxNarr = computeCompanyReadiness({
      ...FULL,
      hasForeignCurrencyTags: false,
      strategicNarrativeLength: 0,
    })
    expect(dropFxNarr.tier).toBe("good")
  })
})
