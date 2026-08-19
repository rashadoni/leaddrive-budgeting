/**
 * 2026-08-19 — the ratio pack, on the client's own May balance.
 *
 * Every figure below is theirs, read at a single month, because a balance is a
 * position on a date. The tests that matter are the ones about signs and about
 * what happens when the map does not recognise an account: a ratio pack fails
 * silently — a misfiled account does not throw, it moves a number the reader
 * then acts on.
 */
import { describe, it, expect } from "vitest"
import { computeBalanceRatios, BALANCE_MAP } from "./balance-ratios"

/** The client's consolidated balance at 31 May 2026, as stored. */
const MAY = [
  ["BS.01.01.01", "Intangible Assets", 349_301],
  ["BS.01.01.02", "Tangible Assets", 158_559_505],
  ["BS.01.01.03", "Long-Term Biological Assets", 1_503_900],
  ["BS.01.01.05", "Equity Investments", 4_088_000],
  ["BS.01.01.07", "Long-Term Receivables", 15_730],
  ["BS.01.01.99", "Deferred Asset", 13_389_546],
  ["BS.01.02.01", "Cash and Cash Equivalents", 13_745_087],
  ["BS.01.02.03", "Inventories", 16_309_264],
  ["BS.01.02.04", "Short-Term Biological Assets", 16_377_111],
  ["BS.01.02.05", "Short-Term Receivables", 6_511_558],
  ["BS.01.02.06", "Other Current Financial Assets", 4_984_144],
  ["BS.01.02.07", "Other Current Assets", 14_118_064],
  ["BS.02.01.01", "Share/Charter capital", -284_954_446],
  ["BS.02.04.01", "Current Year (Profit) / Loss", 1_523_868],
  ["BS.02.04.02", "Accumulated (Profit) / Loss", 66_513_507],
  ["BS.02.04.03", "Adjustments of profit (loss)", 154_397],
  ["BS.03.01.01", "Loans & Borrowings, Long-Term", -8_250_000],
  ["BS.03.01.05", "Other Long-Term Liabilities", -11_334_017],
  ["BS.03.02.01", "Loans & Borrowings, Short-Term", -1_300_000],
  ["BS.03.02.02", "Provisions Short-Term", -1_215_312],
  ["BS.03.02.03", "Payables, Short-Term", -8_103_377],
  ["BS.03.02.04", "Taxes & Other State Payables", -2_179_257],
  ["BS.03.02.05", "Other Short-Term Liabilities", -806_572],
].map(([code, name, amount]) => ({ code: code as string, name: name as string, amount: amount as number }))

/** January–May actual revenue and cost of sales, and the days behind them. */
const FLOWS = { revenue: 12_725_933, cogs: 9_896_711, days: 151 }

const val = (r: ReturnType<typeof computeBalanceRatios>, k: string) =>
  r.ratios.find((x) => x.key === k)!.value

describe("balance ratios on the client's May position", () => {
  const r = computeBalanceRatios(MAY, FLOWS)

  it("reproduces the balance sheet's own identity", () => {
    // Assets against equity plus liabilities. The imported book closes to
    // within a unit on a base of 250 million; anything larger here would mean
    // every ratio below is standing on a balance that does not balance.
    expect(Math.abs(r.balanceCheck)).toBeLessThanOrEqual(2)
    expect(r.totalAssets).toBe(249_951_210)
    expect(r.equity).toBe(216_762_674)
  })

  it("takes equity and liabilities as magnitudes without hiding a sign error", () => {
    // Stored negative, reported positive — but by explicit negation, not
    // Math.abs, so a genuinely wrong sign would surface as a negative ratio
    // instead of being silently rectified.
    expect(r.buckets.payables).toBe(8_103_377)
    expect(r.buckets.debt_long).toBe(8_250_000)
    expect(r.buckets.equity).toBeGreaterThan(0)
  })

  it("computes liquidity", () => {
    expect(val(r, "current")).toBeCloseTo(5.3, 1)
    // Quick excludes both inventory and the growing crops.
    expect(val(r, "quick")).toBeCloseTo(2.89, 2)
  })

  it("finds the group holds net cash, not net debt", () => {
    // Borrowings 9.55M against 13.75M of cash. A leverage screen that showed
    // gross debt would imply a problem that is not there.
    expect(r.netDebt).toBe(-4_195_087)
    expect(val(r, "netDebtToEquity")).toBeLessThan(0)
  })

  it("keeps growing crops out of inventory turnover", () => {
    // Folding the 16.4M of biological assets into stock puts days at ~499,
    // which reads as a supply-chain failure and is actually the growing
    // season. On merchandise inventory alone it is ~249.
    expect(val(r, "dio")).toBeCloseTo(248.9, 0)
    expect(r.buckets.biological).toBe(16_377_111)
    expect(r.buckets.inventory).toBe(16_309_264)
  })

  it("computes the cash cycle from its three parts", () => {
    const dso = val(r, "dso")!
    const dio = val(r, "dio")!
    const dpo = val(r, "dpo")!
    expect(dso).toBeCloseTo(77.3, 0)
    expect(dpo).toBeCloseTo(123.6, 0)
    expect(val(r, "cashCycle")).toBeCloseTo(dso + dio - dpo, 6)
  })

  it("says nothing about days when there are no flows to divide by", () => {
    const noFlow = computeBalanceRatios(MAY, null)
    expect(noFlow.ratios.find((x) => x.key === "dso")).toBeUndefined()
    // The position-only ratios still stand.
    expect(val(noFlow, "current")).toBeCloseTo(5.3, 1)
  })

  it("reports an account the map does not know instead of dropping it", () => {
    // The failure this guards against is silent: an unmapped account simply
    // vanishes from every total, and nothing about the screen looks wrong.
    const withStranger = computeBalanceRatios(
      [...MAY, { code: "BS.09.99.99", name: "Something new", amount: 5_000_000 }],
      FLOWS,
    )
    expect(withStranger.unmapped).toEqual([
      { code: "BS.09.99.99", name: "Something new", amount: 5_000_000 },
    ])
    expect(withStranger.totalAssets).toBe(r.totalAssets)
    // And it shows up in the balance check, because the book no longer closes.
    expect(Math.abs(withStranger.balanceCheck)).toBeGreaterThan(1_000_000)
  })

  it("maps every account the client's chart actually carries", () => {
    // A new account in a future import must be noticed, not absorbed.
    for (const a of MAY) expect(BALANCE_MAP[a.code]).toBeDefined()
  })

  it("refuses a ratio with no denominator", () => {
    const empty = computeBalanceRatios([], FLOWS)
    expect(val(empty, "current")).toBeNull()
    expect(val(empty, "equityRatio")).toBeNull()
  })
})
