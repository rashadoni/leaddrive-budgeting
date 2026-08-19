/**
 * 2026-08-19 — the indirect statement, on the client's own January-to-May move.
 *
 * The decisive assertion is that it reconciles: computed net change must equal
 * the actual movement in cash, 21,168,877 down to 13,745,087. That holds by
 * construction only while the balance sheet balances, which is exactly why it
 * is asserted rather than assumed.
 *
 * The second one that matters is the capital contributions. Two entities were
 * funded over this window — 6,393,180 and 7,476,816 — and a statement that
 * folds those into "result" reports a business that earned 13.9M it did not.
 */
import { describe, it, expect } from "vitest"
import { computeIndirectCashFlow } from "./cash-flow-indirect"
import type { BalanceAccountAmount } from "./balance-ratios"

const at = (rows: Array<[string, number]>): BalanceAccountAmount[] =>
  rows.map(([code, amount]) => ({ code, name: code, amount }))

/** Consolidated balance at the end of January 2026, as stored. */
const OPENING = at([
  ["BS.01.01.01", 87_517], ["BS.01.01.02", 157_443_800], ["BS.01.01.03", 1_575_176],
  ["BS.01.01.05", 1_508_000], ["BS.01.01.07", 15_780], ["BS.01.01.99", 13_525_827],
  ["BS.01.02.01", 21_168_877], ["BS.01.02.03", 19_671_530], ["BS.01.02.04", 7_341_862],
  ["BS.01.02.05", 7_368_131], ["BS.01.02.06", 5_006_033], ["BS.01.02.07", 10_300_552],
  ["BS.02.01.01", -274_897_626], ["BS.02.04.01", 1_429_217], ["BS.02.04.02", 62_665_503],
  ["BS.02.04.03", 178_505],
  ["BS.03.01.01", -8_625_000], ["BS.03.01.05", -9_799_995], ["BS.03.02.01", -1_400_193],
  ["BS.03.02.02", -509_720], ["BS.03.02.03", -9_812_415], ["BS.03.02.04", -2_410_462],
  ["BS.03.02.05", -1_830_899],
])

/** The same, at the end of May. */
const CLOSING = at([
  ["BS.01.01.01", 349_301], ["BS.01.01.02", 158_559_505], ["BS.01.01.03", 1_503_900],
  ["BS.01.01.05", 4_088_000], ["BS.01.01.07", 15_730], ["BS.01.01.99", 13_389_546],
  ["BS.01.02.01", 13_745_087], ["BS.01.02.03", 16_309_264], ["BS.01.02.04", 16_377_111],
  ["BS.01.02.05", 6_511_558], ["BS.01.02.06", 4_984_144], ["BS.01.02.07", 14_118_064],
  ["BS.02.01.01", -284_954_446], ["BS.02.04.01", 1_523_868], ["BS.02.04.02", 66_513_507],
  ["BS.02.04.03", 154_397],
  ["BS.03.01.01", -8_250_000], ["BS.03.01.05", -11_334_017], ["BS.03.02.01", -1_300_000],
  ["BS.03.02.02", -1_215_312], ["BS.03.02.03", -8_103_377], ["BS.03.02.04", -2_179_257],
  ["BS.03.02.05", -806_572],
])

describe("indirect cash flow", () => {
  const cf = computeIndirectCashFlow({ opening: OPENING, closing: CLOSING })

  it("reconciles to the actual movement in cash", () => {
    expect(cf.openingCash).toBe(21_168_877)
    expect(cf.closingCash).toBe(13_745_087)
    expect(cf.netChange).toBeCloseTo(-7_423_790, -1)
    // Zero while the balance sheet balances. Anything else is a real defect
    // in the imported balance, not a rounding convention.
    expect(Math.abs(cf.unreconciled)).toBeLessThanOrEqual(5)
  })

  it("puts the owners' money in financing, not in the result", () => {
    // 10,056,820 of share capital arrived over the window. Counted as result,
    // this business would look like it earned it.
    const contributions = cf.financing.lines.find((l) => l.key === "contributions")!
    expect(contributions.amount).toBe(10_056_820)
    expect(cf.derivedResult).toBeCloseTo(-3_918_547, 0)
  })

  it("shows the growing crops consuming cash", () => {
    // Biological assets went from 7.34M to 16.38M. That is 9M of cash into the
    // ground, and it is the single largest operating movement.
    const bio = cf.operating.lines.find((l) => l.key === "biological")!
    expect(bio.amount).toBeCloseTo(-9_035_249, 0)
    expect(cf.operating.total).toBeLessThan(0)
  })

  it("states the disagreement with the P&L instead of absorbing it", () => {
    const withPnl = computeIndirectCashFlow({
      opening: OPENING, closing: CLOSING, pnlResult: -2_786_112,
    })
    expect(withPnl.resultDisagreement).toBeCloseTo(-1_132_435, 0)
    // And the statement still reconciles — the disagreement is disclosed, not plugged.
    expect(Math.abs(withPnl.unreconciled)).toBeLessThanOrEqual(5)
  })

  it("keeps the bottom line identical whether depreciation is added back", () => {
    const gross = computeIndirectCashFlow({
      opening: OPENING, closing: CLOSING, depreciation: 3_540_610,
    })
    expect(gross.netChange).toBeCloseTo(cf.netChange, 6)
    // Operating improves by the add-back and investing carries it instead.
    expect(gross.operating.total - cf.operating.total).toBeCloseTo(3_540_610, 6)
    expect(gross.investing.total - cf.investing.total).toBeCloseTo(-3_540_610, 6)
  })

  it("reports an unreconciled figure when the balance does not balance", () => {
    const broken = [...CLOSING, { code: "BS.01.02.07", name: "stray", amount: 1_000_000 }]
    const r = computeIndirectCashFlow({ opening: OPENING, closing: broken })
    expect(Math.abs(r.unreconciled)).toBeGreaterThan(900_000)
  })
})
