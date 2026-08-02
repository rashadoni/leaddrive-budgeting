/**
 * The numbers below are the client's own, from `PLF Budget 2026` in
 * `actual-budget-v1.xlsx`, measured on 2026-08-01 and tied to the manat
 * against the workbook's computed rows. Inventing them would test the
 * arithmetic against itself — which is how a fixture with imaginary
 * `PLF.03.01.01` children hid a defect for a week (11.74), and how a fixture
 * that disagreed with itself got a working cross-foot switched off (11.88).
 */
import { describe, it, expect } from "vitest"
import {
  reconcileAgainstStatement,
  reconcilableIndicatorCodes,
} from "./indicator-reconciliation"

/** Four imported entities of `PLF Budget 2026`, as the sheet states them. */
const BUDGET_2026 = {
  "PLF.01": 58_880_102.23,
  "PLF.02": -38_699_923.16,
  "PLF.03": 20_180_179.07,
  "PLF.08": 15_890_431.52,
  "PLF.10": 3_829_841.7,
}

describe("reconcileAgainstStatement", () => {
  it("certifies revenue when the pipeline agrees with the statement", () => {
    const [r] = reconcileAgainstStatement(
      [{ code: "IND_REVENUE_TOTAL", value: 58_880_102.23 }],
      BUDGET_2026,
    )
    expect(r.reconciled).toBe(true)
    expect(r.delta).toBeCloseTo(0, 6)
  })

  it("refuses the 72.3M revenue the screen showed before 11.82", () => {
    // Subsidies and interest income were routed into revenue by a display-layer
    // compensator, and net profit kept tying, so nothing caught it for a year.
    // Against the client's own PLF.01 it is caught immediately.
    const [r] = reconcileAgainstStatement(
      [{ code: "IND_REVENUE_TOTAL", value: 72_333_200.0 }],
      BUDGET_2026,
    )
    expect(r.reconciled).toBe(false)
    expect(r.delta).toBeCloseTo(13_453_097.77, 2)
  })

  it("derives margins from the statement rather than trusting the stored ratio", () => {
    const res = reconcileAgainstStatement(
      [
        { code: "IND_GROSS_MARGIN", value: (20_180_179.07 / 58_880_102.23) * 100 },
        { code: "IND_EBITDA_MARGIN", value: (15_890_431.52 / 58_880_102.23) * 100 },
        { code: "IND_NET_MARGIN", value: (3_829_841.7 / 58_880_102.23) * 100 },
      ],
      BUDGET_2026,
    )
    expect(res).toHaveLength(3)
    expect(res.every((r) => r.reconciled)).toBe(true)
  })

  it("catches the gross margin the pre-11.82 screen would have shown", () => {
    // 33.6M gross profit over 72.3M revenue — both halves inflated by the same
    // 13.45M, so the RATIO looks plausible and only the statement disagrees.
    const [r] = reconcileAgainstStatement(
      [{ code: "IND_GROSS_MARGIN", value: (33_633_277 / 72_333_200) * 100 }],
      BUDGET_2026,
    )
    expect(r.reconciled).toBe(false)
  })

  it("says nothing about an indicator the statement cannot answer", () => {
    // A rainfall forecast and a sugar price are not in a P&L. Returning them as
    // reconciled would certify a number against a source that never mentions
    // it — DASTAN and SAF read exactly such cells and nothing else.
    const res = reconcileAgainstStatement(
      [
        { code: "AGRO_SALYAN_RAINFALL_14D_FCST", value: 0 },
        { code: "AGRO_SUGAR_PRICE_TREND", value: 12 },
        { code: "IND_GOV_CLIMATE_SCORE", value: 38 },
      ],
      BUDGET_2026,
    )
    expect(res).toEqual([])
  })

  it("withholds a margin when the statement has no revenue to divide by", () => {
    // 0/0 is the ABSENCE of a margin, not a margin of zero. Treating it as 0
    // would reconcile an empty company against a computed 0 and certify it —
    // DASTAN and SAF have no budget_lines in either year.
    const res = reconcileAgainstStatement(
      [{ code: "IND_GROSS_MARGIN", value: 0 }],
      { "PLF.01": 0, "PLF.03": 0 },
    )
    expect(res).toEqual([])
  })

  it("withholds when the statement omits the row entirely", () => {
    const res = reconcileAgainstStatement(
      [{ code: "IND_EBITDA_MARGIN", value: 27 }],
      { "PLF.01": 100 },
    )
    expect(res).toEqual([])
  })

  it("skips an unknown value rather than reading it as zero", () => {
    const res = reconcileAgainstStatement(
      [{ code: "IND_REVENUE_TOTAL", value: null }],
      BUDGET_2026,
    )
    expect(res).toEqual([])
  })

  it("names what it is able to check, so the caller can report the rest", () => {
    const codes = reconcilableIndicatorCodes()
    expect(codes).toContain("IND_REVENUE_TOTAL")
    expect(codes).toContain("IND_NET_MARGIN")
    // Deliberately small. Every entry is a claim that a P&L answers this
    // quantity; growing the list is a decision, not a convenience.
    expect(codes.length).toBeLessThanOrEqual(8)
  })
})
