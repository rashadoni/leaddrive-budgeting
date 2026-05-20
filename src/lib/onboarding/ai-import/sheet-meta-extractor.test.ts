import { describe, it, expect } from "vitest"
import {
  extractSheetMetaFromAoa,
} from "./sheet-meta-extractor"

describe("extractSheetMetaFromAoa", () => {
  it("detects header row as the one with most string cells", () => {
    const aoa: unknown[][] = [
      ["Annual Budget 2026", "", ""], // title row — 1 string
      ["Account", "Code", "Amount"], // header row — 3 strings (winner)
      ["Revenue", "PLF.01.01", 100],
      ["COGS", "PLF.02.01", -50],
    ]
    const result = extractSheetMetaFromAoa("PLF CPC", aoa, "A1:C4")
    expect(result.headerRowIndex).toBe(1)
    expect(result.headers).toEqual(["Account", "Code", "Amount"])
    expect(result.totalRows).toBe(4)
    expect(result.isSectionSeparator).toBe(false)
  })

  it("marks separator sheets as such (Actual >>>, etc.)", () => {
    const r1 = extractSheetMetaFromAoa("Actual >>>", [], null)
    expect(r1.isSectionSeparator).toBe(true)
    expect(r1.headers).toEqual([])
    const r2 = extractSheetMetaFromAoa("KPI >>>", [], null)
    expect(r2.isSectionSeparator).toBe(true)
    const r3 = extractSheetMetaFromAoa("CAPEX >>>", [], null)
    expect(r3.isSectionSeparator).toBe(true)
  })

  it("profiles column types correctly", () => {
    const aoa: unknown[][] = [
      ["Date", "Account", "Amount"],
      ["01.01.2026", "PLF.01.01", 100.5],
      ["02.01.2026", "PLF.01.02", 200],
      ["03.01.2026", "PLF.02.01", -50],
    ]
    const result = extractSheetMetaFromAoa("Test", aoa, null)
    const profiles = result.columnProfiles
    // Column 0 = dates
    expect(profiles[0].header).toBe("Date")
    expect(profiles[0].types.date).toBe(3)
    expect(profiles[0].types.number).toBe(0)
    // Column 1 = codes
    expect(profiles[1].header).toBe("Account")
    expect(profiles[1].types.code).toBe(3)
    // Column 2 = numbers
    expect(profiles[2].header).toBe("Amount")
    expect(profiles[2].types.number).toBe(3)
  })

  it("includes sample values from each column", () => {
    const aoa: unknown[][] = [
      ["Account", "Amount"],
      ["Revenue", 100],
      ["COGS", 200],
      ["OPEX", 300],
    ]
    const result = extractSheetMetaFromAoa("Test", aoa, null)
    expect(result.columnProfiles[0].sampleValues).toContain("Revenue")
    expect(result.columnProfiles[0].sampleValues.length).toBeLessThanOrEqual(3)
    expect(result.columnProfiles[1].sampleValues).toContain("100")
  })

  it("caps sample rows + columns", () => {
    const aoa: unknown[][] = [
      Array.from({ length: 30 }, (_, i) => `Col${i}`),
      ...Array.from({ length: 30 }, (_, r) =>
        Array.from({ length: 30 }, (_, c) => `cell${r}_${c}`),
      ),
    ]
    const result = extractSheetMetaFromAoa("Big", aoa, null, {
      sampleRows: 5,
      maxColumns: 10,
    })
    expect(result.sample.length).toBe(5)
    expect(result.headers.length).toBe(10)
    expect(result.sample[0].length).toBe(10)
  })

  it("handles fully empty sheet", () => {
    const result = extractSheetMetaFromAoa("Empty", [], null)
    expect(result.totalRows).toBe(0)
    expect(result.headers).toEqual([])
    expect(result.sample).toEqual([])
    expect(result.isSectionSeparator).toBe(false)
  })

  it("truncates long string cells in sample", () => {
    const longString = "x".repeat(500)
    const aoa: unknown[][] = [
      ["Header"],
      [longString],
    ]
    const result = extractSheetMetaFromAoa("LongCells", aoa, null, {
      truncateCellChars: 50,
    })
    expect(result.sample[0][0].length).toBeLessThanOrEqual(53) // 50 + "..."
  })

  it("handles workbook with title row + later headers (real-world Təsvir-like)", () => {
    const aoa: unknown[][] = [
      ['"EDEN AGRO" MƏHDUD MƏSULİYYƏTLİ CƏMİYYƏT'], // title
      [
        "S/S",
        "Qeydiyyat nömrəsi",
        "Yüklü edilən əmlakın reyestr nömrəsi",
        "Bələdiyyə",
      ],
      [1, "1725022423", "608011001798", "Ağcabədi rayon"],
    ]
    const result = extractSheetMetaFromAoa("Sheet1", aoa, "A1:D3")
    expect(result.headerRowIndex).toBe(1)
    expect(result.headers[0]).toBe("S/S")
  })

  it("ignores rows above headerRow for sample data", () => {
    const aoa: unknown[][] = [
      ["Junk title"],
      ["Header A", "Header B"],
      ["DataA1", "DataB1"],
      ["DataA2", "DataB2"],
    ]
    const result = extractSheetMetaFromAoa("X", aoa, null)
    expect(result.headerRowIndex).toBe(1)
    expect(result.sample[0]).toEqual([
      "DataA1",
      "DataB1",
      ...Array(18).fill(""), // padded to maxColumns
    ])
  })
})
