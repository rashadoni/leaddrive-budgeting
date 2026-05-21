import { describe, it, expect } from "vitest"
import {
  parseIcmalFromAoa,
  parseSalesPlanFromAoa,
} from "./azseker-farming-strategy"

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

// Phase 7.M Tier 6 — Sales plan parser (per-product 2027-2032).
describe("parseSalesPlanFromAoa", () => {
  const makeHeader = (productCol: number) => {
    const row: unknown[] = []
    row[0] = "For PLF"
    row[1] = "Group"
    row[2] = "Location"
    row[3] = "For PL"
    row[productCol] = "Product (Sales)"
    // Year columns: 9 contiguous numeric cells starting at productCol+2
    // (1-cell gap to match real workbook layout).
    let c = productCol + 2
    for (let y = 2027; y <= 2035; y++) {
      row[c++] = y
    }
    return row
  }

  it("parses 1 product × 9 years → 9 facts with stable slug + year + volume", () => {
    const productCol = 6
    const header = makeHeader(productCol)
    const dataRow: unknown[] = []
    dataRow[0] = "Ana məhsul"
    dataRow[1] = "Qlukoza"
    dataRow[2] = "Azerbaijan"
    dataRow[3] = "Glucose"
    dataRow[productCol] = "Qlükoza-G40 Çəki ilə"
    let c = productCol + 2
    let v = 3500
    for (let y = 2027; y <= 2035; y++) {
      dataRow[c++] = v
      v -= 100 // 3500, 3400, ..., 2700
    }
    const result = parseSalesPlanFromAoa([[], header, dataRow])
    expect(result.warnings).toEqual([])
    expect(result.facts).toHaveLength(9)
    expect(result.facts[0]).toMatchObject({
      year: 2027,
      productLabel: "Qlükoza-G40 Çəki ilə",
      productSlug: "qlukoza_g40_ceki_ile",
      group: "Qlukoza",
      location: "Azerbaijan",
      volumeTons: 3500,
    })
    expect(result.facts[8]).toMatchObject({ year: 2035, volumeTons: 2700 })
  })

  it("skips zero-volume cells to avoid noise (typical for not-yet-launched products)", () => {
    const productCol = 6
    const header = makeHeader(productCol)
    const dataRow: unknown[] = []
    dataRow[0] = "Ana məhsul"
    dataRow[1] = "Fruktoza"
    dataRow[2] = "Azerbaijan"
    dataRow[productCol] = "Fruktoza F-55"
    // Years 2027-2028 are 0 (not launched yet), 2029-2035 ramp up
    let c = productCol + 2
    for (let y = 2027; y <= 2035; y++) {
      dataRow[c++] = y >= 2029 ? 1000 : 0
    }
    const result = parseSalesPlanFromAoa([[], header, dataRow])
    expect(result.facts).toHaveLength(7) // 9 - 2 zeros
    expect(result.facts.every((f) => f.year >= 2029)).toBe(true)
  })

  it("treats Location='---' as empty string (used for byproducts)", () => {
    const productCol = 6
    const header = makeHeader(productCol)
    const dataRow: unknown[] = []
    dataRow[0] = "Yan məhsul"
    dataRow[1] = "Yan məhsul"
    dataRow[2] = "---"
    dataRow[productCol] = "Qlüten Çəki ilə"
    dataRow[productCol + 2] = 1275
    const result = parseSalesPlanFromAoa([[], header, dataRow])
    expect(result.facts[0].location).toBe("")
    expect(result.facts[0].group).toBe("Yan məhsul")
  })

  it("skips rows without a product label (filters out blank trailing rows)", () => {
    const productCol = 6
    const header = makeHeader(productCol)
    const blankRow: unknown[] = []
    blankRow[1] = "Qlukoza"
    blankRow[productCol + 2] = 1000 // value present but no product label
    const result = parseSalesPlanFromAoa([[], header, blankRow])
    expect(result.facts).toEqual([])
    expect(result.rowsExamined).toBe(0)
  })

  it("returns warning when 'Product (Sales)' header not found", () => {
    const result = parseSalesPlanFromAoa([
      [],
      ["wrong", "headers", "here"],
      ["data", 1, 2],
    ])
    expect(result.facts).toEqual([])
    expect(result.warnings[0]).toMatch(/Product \(Sales\).*not found/)
  })

  it("stops collecting year cols at first non-year cell to avoid second 2027-2035 block (cost / price)", () => {
    // Real workbook has VOLUME 2027-2035, then null, then "2026", then
    // null, then PRODUCTION 2027-2035, etc. The parser must only pick
    // up the FIRST contiguous run of year cells.
    const productCol = 6
    const header: unknown[] = []
    header[productCol] = "Product (Sales)"
    let c = productCol + 2
    for (let y = 2027; y <= 2035; y++) header[c++] = y
    header[c++] = null
    header[c++] = "2026" // string, not number — defensive against re-pick
    header[c++] = null
    for (let y = 2027; y <= 2035; y++) header[c++] = y

    const dataRow: unknown[] = []
    dataRow[1] = "X"
    dataRow[productCol] = "TestProduct"
    let dc = productCol + 2
    for (let y = 2027; y <= 2035; y++) dataRow[dc++] = 100
    dc++ // null gap
    dc++ // "2026" col
    dc++ // null gap
    for (let y = 2027; y <= 2035; y++) dataRow[dc++] = 999 // these MUST be ignored

    const result = parseSalesPlanFromAoa([[], header, dataRow])
    expect(result.facts).toHaveLength(9)
    expect(result.facts.every((f) => f.volumeTons === 100)).toBe(true)
  })
})
