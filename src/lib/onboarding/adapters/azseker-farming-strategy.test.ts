import { describe, it, expect } from "vitest"
import { parseIcmalFromAoa } from "./azseker-farming-strategy"

describe("parseIcmalFromAoa", () => {
  it("parses real-world layout — year header at row 3, Revenue rows below", () => {
    const aoa: unknown[][] = [
      [], // row 0: empty
      [null, "Business Unit"],
      [null, "All"],
      [null, null, 2026, 2027, 2028, 2029, 2030, 2031, null, null, null, null, null, "Terminal"], // row 3: year header
      ["Group", "Satış gəliri", 58_880_102, 94_804_155, 196_249_609, 0, 0, 0, null, null, null, null, null, 308_465_932], // total — skipped
      ["Revenue", "Buğda", 15_836_740, 19_273_447, 20_798_308, 0, 0, 0, null, null, null, null, null, 32_711_662],
      ["Revenue", "Şəkər çuğunduru", 5_423_090, 5_423_090, 5_640_013, 0, 0, 0, null, null, null, null, null, 7_718_748],
      ["Revenue", "Qarğıdalı", 0, 0, 0, 0, 0, 0],
      ["Revenue", "Pambıq", 6_545_120, 6_717_360, 7_165_184],
      ["Revenue", "Arpa", 3_136_000, 2_888_000, 3_078_400],
    ]
    const result = parseIcmalFromAoa(aoa)
    expect(result.warnings).toEqual([])
    expect(result.forecast.length).toBe(6) // 2026..2031
    expect(result.hasTerminalValue).toBe(true)

    // 2026: 4 non-zero BUs (Qarğıdalı is 0, excluded)
    const f2026 = result.forecast.find((f) => f.year === 2026)!
    expect(f2026.breakdown.length).toBe(4)
    expect(f2026.breakdown.find((b) => b.businessUnit === "Buğda")?.revenueAzn).toBe(15_836_740)
    // Top BU should sort first
    expect(f2026.breakdown[0].businessUnit).toBe("Buğda")
    expect(f2026.totalRevenueAzn).toBe(15_836_740 + 5_423_090 + 6_545_120 + 3_136_000)

    // 2027 totals
    const f2027 = result.forecast.find((f) => f.year === 2027)!
    expect(f2027.totalRevenueAzn).toBe(19_273_447 + 5_423_090 + 6_717_360 + 2_888_000)
  })

  it("returns warning when year header not found", () => {
    const aoa: unknown[][] = [
      ["Junk header"],
      ["More junk"],
      ["Revenue", "Buğda", "not-a-year-here"],
    ]
    const result = parseIcmalFromAoa(aoa)
    expect(result.forecast).toEqual([])
    expect(result.warnings.length).toBe(1)
  })

  it("skips total row 'Satış gəliri' from breakdown", () => {
    const aoa: unknown[][] = [
      [null, null, 2026, 2027],
      ["Group", "Satış gəliri", 99_999_999, 88_888_888], // should be skipped
      ["Revenue", "Buğda", 1000, 2000],
    ]
    const result = parseIcmalFromAoa(aoa)
    // Only Buğda in the breakdown, not the totals row
    expect(result.forecast[0].breakdown.length).toBe(1)
    expect(result.forecast[0].breakdown[0].businessUnit).toBe("Buğda")
    expect(result.forecast[0].totalRevenueAzn).toBe(1000)
  })

  it("handles string-encoded number cells (comma decimal separator)", () => {
    const aoa: unknown[][] = [
      [null, null, 2026, 2027],
      ["Revenue", "Test", "1234,56", "2345.67"],
    ]
    const result = parseIcmalFromAoa(aoa)
    expect(result.forecast[0].breakdown[0].revenueAzn).toBeCloseTo(1234.56)
    expect(result.forecast[1].breakdown[0].revenueAzn).toBeCloseTo(2345.67)
  })

  it("orders breakdown by revenue descending", () => {
    const aoa: unknown[][] = [
      [null, null, 2026],
      ["Revenue", "Small", 100],
      ["Revenue", "Big", 1000],
      ["Revenue", "Mid", 500],
    ]
    const result = parseIcmalFromAoa(aoa)
    expect(result.forecast[0].breakdown.map((b) => b.businessUnit)).toEqual([
      "Big",
      "Mid",
      "Small",
    ])
  })

  it("handles zero-revenue years by emitting empty breakdown but year present", () => {
    const aoa: unknown[][] = [
      [null, null, 2026, 2027],
      ["Revenue", "Buğda", 0, 1000],
    ]
    const result = parseIcmalFromAoa(aoa)
    expect(result.forecast.length).toBe(2)
    const f2026 = result.forecast.find((f) => f.year === 2026)!
    expect(f2026.breakdown.length).toBe(0)
    expect(f2026.totalRevenueAzn).toBe(0)
  })
})
