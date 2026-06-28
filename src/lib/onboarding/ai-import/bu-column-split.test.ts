import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import {
  findBuColumn,
  splitByBuColumn,
  applyBuColumnSplit,
  looksLikeBuConsolidated,
  inferStatementMeta,
} from "./bu-column-split"
import { buildEntityAliasMap } from "./entity-inference"

const aliasMap = buildEntityAliasMap(
  ["AZSEKER", "AZSEKER-CPC", "AZSEKER-EDEN", "AZSEKER-PROMALT"],
  { AZSF: "AZSEKER" },
)

// Synthetic consolidated sheet mirroring actual-budget-v1.xlsx:
//   row0 = title, row1 = header carrying "BU" at col index 3, then stacked
//   per-entity blocks (each row tagged with its BU in col 3).
function makeConsolidated(blocks: Array<[string, number]>): XLSX.WorkSheet {
  const rows: unknown[][] = [
    ["Consolidated", null, null, null],
    ["Code", "Name", "Jan", "BU"],
  ]
  for (const [bu, n] of blocks) {
    for (let i = 0; i < n; i++) rows.push([`PLF.0${(i % 9) + 1}`, `row ${i}`, 100 + i, bu])
  }
  return XLSX.utils.aoa_to_sheet(rows)
}

function wbWith(name: string, ws: XLSX.WorkSheet): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, name)
  return wb
}

describe("findBuColumn", () => {
  it("finds the 'BU' header column index", () => {
    expect(findBuColumn([["Code", "Name", "Jan", "BU"]])).toBe(3)
  })
  it("returns -1 when no BU header is in the scan window", () => {
    expect(findBuColumn([["Code", "Name", "Amount"]])).toBe(-1)
  })
  it("is case-insensitive and trims surrounding space", () => {
    expect(findBuColumn([["x", " bu "]])).toBe(1)
  })
})

describe("splitByBuColumn", () => {
  it("splits a 3-block consolidated sheet by the BU column", () => {
    const wb = wbWith("PLF Actual 2025", makeConsolidated([["CPC", 5], ["AZSF", 6], ["EDEN", 4]]))
    const res = splitByBuColumn(wb, "PLF Actual 2025", XLSX, aliasMap)
    expect(res.buColumn).toBe(3)
    expect(res.blocks.map((b) => b.entityCode)).toEqual([
      "AZSEKER-CPC",
      "AZSEKER", // AZSF alias → holding
      "AZSEKER-EDEN",
    ])
    expect(res.blocks.map((b) => b.rowCount)).toEqual([5, 6, 4])
  })

  it("prepends the shared preamble (header) to each virtual sheet", () => {
    const wb = wbWith("PLF Actual 2025", makeConsolidated([["CPC", 4], ["EDEN", 4]]))
    const { blocks } = splitByBuColumn(wb, "PLF Actual 2025", XLSX, aliasMap)
    const aoaA = XLSX.utils.sheet_to_json<unknown[]>(blocks[0].worksheet, {
      header: 1,
      blankrows: false,
    }) as unknown[][]
    expect(aoaA).toHaveLength(6) // 2 preamble rows + 4 block rows
    expect(aoaA[1]?.[3]).toBe("BU") // header preserved
    expect(aoaA.slice(2).every((r) => r[3] === "CPC")).toBe(true) // only CPC's rows
  })

  it("is a single-block no-op for a single-entity sheet", () => {
    const { blocks } = splitByBuColumn(
      wbWith("PLF EDEN", makeConsolidated([["EDEN", 8]])),
      "PLF EDEN",
      XLSX,
      aliasMap,
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].entityCode).toBe("AZSEKER-EDEN")
  })

  it("returns no blocks when there is no BU column", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Code", "Name", "Amount"], ["PLF.01", "Rev", 100]])
    const res = splitByBuColumn(wbWith("X", ws), "X", XLSX, aliasMap)
    expect(res.buColumn).toBe(-1)
    expect(res.blocks).toEqual([])
  })

  it("gives an UNKNOWN BU value its own null-entity block (never merges it)", () => {
    const wb = wbWith(
      "PLF Actual 2025",
      makeConsolidated([["CPC", 4], ["HORIZON", 4], ["EDEN", 4]]),
    )
    const { blocks } = splitByBuColumn(wb, "PLF Actual 2025", XLSX, aliasMap)
    expect(blocks.map((b) => b.entityCode)).toEqual(["AZSEKER-CPC", null, "AZSEKER-EDEN"])
  })

  it("filters a too-short stray block (< minBlockRows)", () => {
    const wb = wbWith(
      "PLF Actual 2025",
      makeConsolidated([["CPC", 5], ["EDEN", 1], ["AZSF", 5]]),
    )
    const { blocks, warnings } = splitByBuColumn(wb, "PLF Actual 2025", XLSX, aliasMap)
    expect(blocks.map((b) => b.entityCode)).toEqual(["AZSEKER-CPC", "AZSEKER"])
    expect(warnings.some((w) => w.includes("EDEN"))).toBe(true)
  })
})

describe("applyBuColumnSplit", () => {
  it("splits, adds per-entity sheets, removes the raw sheet, and pins routing", () => {
    const wb = wbWith("PLF Actual 2025", makeConsolidated([["CPC", 5], ["AZSF", 6], ["EDEN", 4]]))
    const res = applyBuColumnSplit(wb, XLSX, {
      sheetName: "PLF Actual 2025",
      dataType: "PLF",
      planKind: "actual",
      aliasMap,
    })
    expect(res.applied).toBe(true)
    expect(res.sheetMapEntries).toHaveLength(3)
    expect(res.sheetMapEntries[0]).toMatchObject({
      match: "PLF Actual 2025 [AZSEKER-CPC]",
      dataType: "PLF",
      planKind: "actual",
      role: "source",
      entityCode: "AZSEKER-CPC",
    })
    expect(wb.SheetNames).not.toContain("PLF Actual 2025")
    expect(wb.SheetNames).toContain("PLF Actual 2025 [AZSEKER]")
    expect(wb.SheetNames).toContain("PLF Actual 2025 [AZSEKER-EDEN]")
  })

  it("is a no-op for a single-entity sheet (raw sheet untouched)", () => {
    const wb = wbWith("PLF EDEN", makeConsolidated([["EDEN", 8]]))
    const res = applyBuColumnSplit(wb, XLSX, { sheetName: "PLF EDEN", dataType: "PLF", aliasMap })
    expect(res.applied).toBe(false)
    expect(wb.SheetNames).toContain("PLF EDEN")
  })

  it("skips an unknown-entity block but still splits the known ones", () => {
    const wb = wbWith(
      "PLF Actual 2025",
      makeConsolidated([["CPC", 5], ["HORIZON", 5], ["EDEN", 5]]),
    )
    const res = applyBuColumnSplit(wb, XLSX, {
      sheetName: "PLF Actual 2025",
      dataType: "PLF",
      planKind: "actual",
      aliasMap,
    })
    expect(res.applied).toBe(true)
    expect(res.sheetMapEntries.map((e) => e.entityCode)).toEqual(["AZSEKER-CPC", "AZSEKER-EDEN"])
    expect(res.warnings.some((w) => w.includes("HORIZON"))).toBe(true)
    expect(wb.SheetNames).not.toContain("PLF Actual 2025")
  })

  it("omits planKind from the map entry when not supplied", () => {
    const wb = wbWith("PLF Actual 2025", makeConsolidated([["CPC", 4], ["EDEN", 4]]))
    const res = applyBuColumnSplit(wb, XLSX, { sheetName: "PLF Actual 2025", dataType: "PLF", aliasMap })
    expect(res.sheetMapEntries[0].planKind).toBeUndefined()
  })
})

describe("looksLikeBuConsolidated", () => {
  it("true for a multi-entity BU sheet", () => {
    const wb = wbWith("PLF Actual 2025", makeConsolidated([["CPC", 4], ["EDEN", 4]]))
    expect(looksLikeBuConsolidated(wb, "PLF Actual 2025", XLSX, aliasMap)).toBe(true)
  })
  it("false for a single-entity BU sheet", () => {
    const wb = wbWith("PLF EDEN", makeConsolidated([["EDEN", 8]]))
    expect(looksLikeBuConsolidated(wb, "PLF EDEN", XLSX, aliasMap)).toBe(false)
  })
  it("false when there is no BU column", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Code", "Amount"], ["PLF.01", 1]])
    expect(looksLikeBuConsolidated(wbWith("X", ws), "X", XLSX, aliasMap)).toBe(false)
  })
})

describe("inferStatementMeta", () => {
  it("PLF / actual", () =>
    expect(inferStatementMeta("PLF Actual 2025")).toEqual({ dataType: "PLF", planKind: "actual" }))
  it("BS / actual", () =>
    expect(inferStatementMeta("BS Actual 2025")).toEqual({ dataType: "BS", planKind: "actual" }))
  it("PLF / budget", () =>
    expect(inferStatementMeta("PLF Budget 2026")).toEqual({ dataType: "PLF", planKind: "budget" }))
  it("CF with no plan keyword → dataType only", () =>
    expect(inferStatementMeta("CF 2025")).toEqual({ dataType: "CF" }))
  it("null for a non-statement sheet", () =>
    expect(inferStatementMeta("Satış CPC Fakt")).toBeNull())
})
