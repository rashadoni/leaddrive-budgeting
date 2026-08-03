import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import {
  findBuColumn,
  splitByBuColumn,
  applyBuColumnSplit,
  looksLikeBuConsolidated,
  inferStatementMeta,
  hasMultiEntityBuColumn,
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
  it("without an aliasMap ignores numbered BU_N columns (legacy behaviour)", () => {
    expect(findBuColumn([["Code", "BU_1", "BU_3"]])).toBe(-1)
  })

  // "PLF Budget 2026" shape (N. Nəcəfzadə.xlsx): no plain "BU" header; BU_1
  // tags the parent group (mislabels CPC + AJE blocks as EDEN), BU_3 is the
  // true per-block entity column, BU_2/BU_4 are non-entity dimensions.
  const budgetShapeRows: unknown[][] = [
    ["Code", "Name", "Jan", "BU_1", "BU_2", "BU_3", "BU_4"],
    ...(["EDEN", "AZSF", "PROMALT", "CPC", "AJE"] as const).flatMap((entity) =>
      Array.from({ length: 4 }, (_, i) => [
        `PLF.0${i + 1}`,
        `row ${i}`,
        100 + i,
        entity === "CPC" || entity === "AJE" ? "EDEN" : entity, // BU_1 mislabel
        entity === "PROMALT" ? "JV" : "Core",
        entity, // BU_3 — true entity
        entity === "CPC" || entity === "PROMALT" ? "Production" : "Farming",
      ]),
    ),
  ]

  it("with an aliasMap picks the BU_N column resolving the most distinct entities", () => {
    // BU_1 resolves {EDEN, AZSF, PROMALT} = 3; BU_3 resolves 4 (+AJE elim) → BU_3.
    expect(findBuColumn(budgetShapeRows, aliasMap)).toBe(5)
  })

  it("prefers the exact 'BU' header on a distinct-entity tie", () => {
    const rows: unknown[][] = [
      ["Code", "BU", "BU_1"],
      ["x", "CPC", "CPC"],
      ["x", "EDEN", "EDEN"],
    ]
    expect(findBuColumn(rows, aliasMap)).toBe(1)
  })

  it("falls back to the exact 'BU' column when no candidate resolves a known entity", () => {
    const rows: unknown[][] = [
      ["Code", "BU", "BU_1"],
      ["x", "SOMETHING", "OTHER"],
    ]
    expect(findBuColumn(rows, aliasMap)).toBe(1)
  })

  it("returns -1 when only unknown BU_N candidates exist", () => {
    const rows: unknown[][] = [
      ["Code", "BU_1"],
      ["x", "SOMETHING"],
    ]
    expect(findBuColumn(rows, aliasMap)).toBe(-1)
  })

  // 11.83 — this used to assert `action: "skip", reason: "elimination"` for
  // AJE. On the real file that block is 394 rows carrying −1,677,014.63 AZN of
  // EDEN's non-recoverable VAT, and BU_1 says EDEN on every one of them. The
  // old assertion was the defect written down as an expectation.
  it("splits the budget shape into 4 entity sheets via BU_3 and FOLDS AJE into its BU_1 owner", () => {
    const ws = XLSX.utils.aoa_to_sheet(budgetShapeRows)
    const wb = wbWith("PLF Budget 2026", ws)
    const res = applyBuColumnSplit(wb, XLSX, {
      sheetName: "PLF Budget 2026",
      dataType: "PLF",
      planKind: "budget",
      aliasMap,
    })
    expect(res.applied).toBe(true)
    expect(res.sheetMapEntries.map((e) => e.entityCode)).toEqual([
      "AZSEKER-EDEN",
      "AZSEKER", // AZSF alias → holding
      "AZSEKER-PROMALT",
      "AZSEKER-CPC",
    ])
    expect(res.sheetMapEntries.every((e) => e.planKind === "budget")).toBe(true)
    // AJE is reported as a WRITE against EDEN — the rows are imported.
    expect(res.mapping).toContainEqual({
      sheetName: "PLF Budget 2026 [AZSEKER-EDEN]",
      entityCode: "AZSEKER-EDEN",
      buValue: "AJE",
      rowCount: 4,
      action: "write",
      foldedInto: { entityCode: "AZSEKER-EDEN", viaHeader: "BU_1" },
    })
    // No AJE sheet of its own: a second sheet for the same company would be
    // clean-slated away by the first (one archive per sheet, per plan × year).
    expect(res.sheetMapEntries).toHaveLength(4)
    expect(wb.SheetNames).not.toContain("PLF Budget 2026")
    expect(wb.SheetNames).toContain("PLF Budget 2026 [AZSEKER-CPC]")
    expect(wb.SheetNames.filter((n) => n.includes("AZSEKER-EDEN"))).toEqual([
      "PLF Budget 2026 [AZSEKER-EDEN]",
    ])
  })

  it("the AJE rows physically land in EDEN's virtual sheet, none are lost", () => {
    const ws = XLSX.utils.aoa_to_sheet(budgetShapeRows)
    const wb = wbWith("PLF Budget 2026", ws)
    applyBuColumnSplit(wb, XLSX, {
      sheetName: "PLF Budget 2026",
      dataType: "PLF",
      planKind: "budget",
      aliasMap,
    })
    const eden = XLSX.utils.sheet_to_json<unknown[]>(
      wb.Sheets["PLF Budget 2026 [AZSEKER-EDEN]"],
      { header: 1, raw: true, blankrows: false },
    ) as unknown[][]
    // header + EDEN's own 4 rows + AJE's 4 rows.
    expect(eden).toHaveLength(9)
    const bu3 = eden.slice(1).map((r) => r[5])
    expect(bu3).toEqual(["EDEN", "EDEN", "EDEN", "EDEN", "AJE", "AJE", "AJE", "AJE"])
    // CPC's sheet is untouched by the fold.
    const cpc = XLSX.utils.sheet_to_json<unknown[]>(
      wb.Sheets["PLF Budget 2026 [AZSEKER-CPC]"],
      { header: 1, raw: true, blankrows: false },
    ) as unknown[][]
    expect(cpc).toHaveLength(5)
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

  it("marks EJE/AJE/elimination BU values as skipped blocks", () => {
    const wb = wbWith(
      "PLF Actual 2025",
      makeConsolidated([["CPC", 4], ["EJE", 4], ["EDEN", 4]]),
    )
    const { blocks } = splitByBuColumn(wb, "PLF Actual 2025", XLSX, aliasMap)
    expect(blocks.map((b) => [b.buValue, b.entityCode, b.skipReason])).toEqual([
      ["CPC", "AZSEKER-CPC", undefined],
      ["EJE", null, "elimination"],
      ["EDEN", "AZSEKER-EDEN", undefined],
    ])
  })

  // ── 11.83 — adjustment blocks ────────────────────────────────────────
  //
  // `makeConsolidated` builds a sheet with ONE BU column, which is the
  // unattributable case: there is no parent dimension to read, so an AJE block
  // must stay skipped — but it must say why, and it must not be filed as an
  // elimination.
  it("keeps an AJE block skipped when the sheet has no parent BU dimension — loudly", () => {
    const wb = wbWith(
      "PLF Actual 2025",
      makeConsolidated([["CPC", 4], ["AJE", 4], ["EDEN", 4]]),
    )
    const { blocks, warnings } = splitByBuColumn(wb, "PLF Actual 2025", XLSX, aliasMap)
    const aje = blocks.find((b) => b.buValue === "AJE")!
    expect(aje.entityCode).toBeNull()
    expect(aje.skipReason).toBe("adjustment")
    expect(aje.foldedInto).toBeUndefined()
    expect(
      warnings.some(
        (w) => w.includes('"AJE"') && w.includes("NOT imported") && w.includes("adjustment"),
      ),
    ).toBe(true)
  })

  it("never folds an EJE block, even when its parent column names a company", () => {
    // The real EJE blocks are their own parent, but the guard must not depend
    // on that: an elimination is unattributable by definition.
    const rows: unknown[][] = [
      ["Code", "Name", "Jan", "BU_1", "BU_3"],
      ...Array.from({ length: 4 }, () => ["PLF.01.01.01", "r", 10, "EDEN", "EDEN"]),
      ...Array.from({ length: 4 }, () => ["PLF.01.01.01", "elim", -3, "EDEN", "EJE"]),
    ]
    const wb = wbWith("PLF Actual 2026", XLSX.utils.aoa_to_sheet(rows))
    const { blocks } = splitByBuColumn(wb, "PLF Actual 2026", XLSX, aliasMap)
    const eje = blocks.find((b) => b.buValue === "EJE")!
    expect(eje.entityCode).toBeNull()
    expect(eje.skipReason).toBe("elimination")
    expect(eje.foldedInto).toBeUndefined()
    const eden = blocks.find((b) => b.buValue === "EDEN")!
    expect(eden.foldedFrom).toBeUndefined()
  })

  it("skips an AJE block whose owner has no block on this sheet", () => {
    // BU_3 is the entity column (3 known vs BU_1's 1); AJE's BU_1 names AZSF,
    // which has no block here — so there is nothing to fold into.
    const rows: unknown[][] = [
      ["Code", "Name", "Jan", "BU_1", "BU_3"],
      ...(["EDEN", "CPC", "PROMALT"] as const).flatMap((e) =>
        Array.from({ length: 3 }, () => ["PLF.01.01.01", "r", 10, "GROUP", e]),
      ),
      ...Array.from({ length: 3 }, () => ["PLF.05.12.06", "VAT", -1000, "AZSF", "AJE"]),
    ]
    const wb = wbWith("PLF Budget 2026", XLSX.utils.aoa_to_sheet(rows))
    const { blocks, warnings } = splitByBuColumn(wb, "PLF Budget 2026", XLSX, aliasMap)
    expect(blocks.map((b) => b.buValue)).toEqual(["EDEN", "CPC", "PROMALT", "AJE"])
    const aje = blocks.find((b) => b.buValue === "AJE")!
    expect(aje.foldedInto).toBeUndefined()
    expect(aje.skipReason).toBe("adjustment")
    expect(
      warnings.some((w) => w.includes("has no block on this sheet") && w.includes("NOT imported")),
    ).toBe(true)
  })

  it("records the fold on both sides (foldedInto / foldedFrom)", () => {
    const rows: unknown[][] = [
      ["Code", "Name", "Jan", "BU_1", "BU_3"],
      ...Array.from({ length: 4 }, () => ["PLF.01.01.01", "r", 10, "EDEN", "EDEN"]),
      ...Array.from({ length: 3 }, () => ["PLF.05.12.06", "VAT", -1000, "EDEN", "AJE"]),
    ]
    const wb = wbWith("PLF Budget 2026", XLSX.utils.aoa_to_sheet(rows))
    const { blocks } = splitByBuColumn(wb, "PLF Budget 2026", XLSX, aliasMap)
    expect(blocks.find((b) => b.buValue === "AJE")!.foldedInto).toEqual({
      entityCode: "AZSEKER-EDEN",
      viaHeader: "BU_1",
      label: "EDEN",
    })
    expect(blocks.find((b) => b.buValue === "EDEN")!.foldedFrom).toEqual([
      { buValue: "AJE", rowCount: 3, viaHeader: "BU_1" },
    ])
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
    expect(res.mapping.some((m) => m.action === "skip" && m.reason === "unknown_alias")).toBe(true)
    expect(wb.SheetNames).not.toContain("PLF Actual 2025")
  })

  it("splits one known entity plus an EJE block so elimination rows are skipped", () => {
    const wb = wbWith("PLF Actual 2025", makeConsolidated([["CPC", 5], ["EJE", 5]]))
    const res = applyBuColumnSplit(wb, XLSX, {
      sheetName: "PLF Actual 2025",
      dataType: "PLF",
      planKind: "actual",
      aliasMap,
    })
    expect(res.applied).toBe(true)
    expect(res.sheetMapEntries).toHaveLength(1)
    expect(res.mapping).toEqual([
      {
        sheetName: "PLF Actual 2025 [AZSEKER-CPC]",
        entityCode: "AZSEKER-CPC",
        buValue: "CPC",
        rowCount: 5,
        action: "write",
      },
      {
        sheetName: "PLF Actual 2025",
        entityCode: null,
        buValue: "EJE",
        rowCount: 5,
        action: "skip",
        reason: "elimination",
      },
    ])
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

describe("hasMultiEntityBuColumn", () => {
  it("true when a 'BU' column carries ≥2 distinct entities", () => {
    const rows = [
      ["Code", "Name", "Jan", "BU"],
      ["PLF.01", "r", 1, "CPC"],
      ["PLF.02", "r", 1, "CPC"],
      ["PLF.01", "r", 1, "EDEN"],
      ["PLF.02", "r", 1, "EDEN"],
    ]
    expect(hasMultiEntityBuColumn(rows, aliasMap)).toBe(true)
  })

  it("true for a numbered BU_N dimension column (e.g. an entity×sub-unit budget)", () => {
    const rows = [
      ["Code", "Name", "BU_1", "BU_3"],
      ["x", "r", "EDEN", "EDEN"],
      ["x", "r", "EDEN", "CPC"], // BU_3 disagrees with BU_1 → multi-entity dimension
    ]
    expect(hasMultiEntityBuColumn(rows, aliasMap)).toBe(true)
  })

  it("false for a single-entity BU column", () => {
    const rows = [["Code", "BU"], ["PLF.01", "EDEN"], ["PLF.02", "EDEN"]]
    expect(hasMultiEntityBuColumn(rows, aliasMap)).toBe(false)
  })

  it("false when there is no BU column at all", () => {
    expect(hasMultiEntityBuColumn([["Code", "Amount"], ["PLF.01", 1]], aliasMap)).toBe(false)
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

/**
 * Phase 14.8 — the EJE block stops being dropped, on a BALANCE SHEET only.
 *
 * `BS Actual 2026` ships the client's own INTRAGROUP ELIMINATIONS as a fifth
 * block. It nets 123,200,854.11 of intercompany holdings and receivables out
 * of the 373,152,064.18 the screen shows at 2026-05. Dropping it is why the
 * product has no consolidated balance sheet at any surface.
 */
describe("elimination block routing (14.8)", () => {
  const bsWith = (blocks: Array<[string, number]>) =>
    wbWith("BS Actual 2026", makeConsolidated(blocks))

  const splitBs = (blocks: Array<[string, number]>, dataType: "BS" | "PLF" = "BS") =>
    applyBuColumnSplit(bsWith(blocks), XLSX, {
      sheetName: "BS Actual 2026",
      dataType,
      planKind: "actual",
      aliasMap,
    })

  it("materialises the EJE block as its own BS_ELIMINATIONS sheet", () => {
    const out = splitBs([["CPC", 5], ["EDEN", 5], ["EJE", 4]])
    const elim = out.sheetMapEntries.filter((e) => e.dataType === "BS_ELIMINATIONS")
    expect(elim).toHaveLength(1)
    expect(elim[0].match).toBe("BS Actual 2026 [ELIMINATIONS]")
    expect(elim[0].role).toBe("source")
    expect(elim[0].planKind).toBe("actual")
  })

  it("gives it NO entityCode — the load-bearing one", () => {
    // The block's own labels name four companies ("Investments in Joint
    // Ventures (ProMalt Investment)", "Receivable from Corn sold to CPC"), so
    // a cell scan is perfectly capable of guessing one. A guess here puts the
    // whole group's −119M reversal on that company.
    const out = splitBs([["CPC", 5], ["EDEN", 5], ["EJE", 4]])
    const elim = out.sheetMapEntries.find((e) => e.dataType === "BS_ELIMINATIONS")!
    expect(elim.entityCode).toBeUndefined()
  })

  it("reports it as a write exactly once, never also as a skip", () => {
    const out = splitBs([["CPC", 5], ["EDEN", 5], ["EJE", 4]])
    const eje = out.mapping.filter((m) => m.buValue === "EJE")
    expect(eje).toHaveLength(1)
    expect(eje[0].action).toBe("write")
    expect(eje[0].entityCode).toBeNull()
    expect(eje[0].reason).toBe("elimination")
  })

  it("leaves the entity blocks exactly as they were", () => {
    const out = splitBs([["CPC", 5], ["EDEN", 5], ["EJE", 4]])
    expect(
      out.sheetMapEntries.filter((e) => e.dataType === "BS").map((e) => e.entityCode).sort(),
    ).toEqual(["AZSEKER-CPC", "AZSEKER-EDEN"])
    expect(out.applied).toBe(true)
  })

  it("still SKIPS the elimination block on a P&L sheet", () => {
    // 11.83 settled the ADJUSTMENT half of the P&L question and deliberately
    // left the elimination half alone. This must not change it by accident.
    const out = splitBs([["CPC", 5], ["EDEN", 5], ["EJE", 4]], "PLF")
    expect(out.sheetMapEntries.some((e) => e.dataType === "BS_ELIMINATIONS")).toBe(false)
    const eje = out.mapping.filter((m) => m.buValue === "EJE")
    expect(eje).toHaveLength(1)
    expect(eje[0].action).toBe("skip")
  })

  it("refuses TWO elimination blocks rather than importing either", () => {
    // The write path clean-slates per (plan × scope × year) once per sheet, so
    // two elimination sheets would each archive the other's rows — the
    // 2026-06-11 collateral-wipe shape. Both are skipped, loudly.
    const out = splitBs([["CPC", 5], ["EJE", 4], ["EDEN", 5], ["INTERCOMPANY", 4]])
    expect(out.sheetMapEntries.some((e) => e.dataType === "BS_ELIMINATIONS")).toBe(false)
    expect(out.warnings.join("\n")).toMatch(/2 elimination blocks/)
    for (const m of out.mapping.filter((x) => x.reason === "elimination")) {
      expect(m.action).toBe("skip")
    }
  })

  it("says what happened, in the warning a reviewer reads", () => {
    const out = splitBs([["CPC", 5], ["EDEN", 5], ["EJE", 4]])
    const text = out.warnings.join("\n")
    expect(text).toMatch(/intragroup-elimination block/)
    expect(text).toMatch(/belonging to no company/)
    // The old "skipped (not imported)" line must be gone for this block.
    expect(text).not.toMatch(/"EJE".*looks like elimination/)
  })
})

/**
 * The narrowest and most dangerous distinction in 14.8: a CONSOLIDATED block
 * is the group's TOTALS, not its eliminations. Both are "not a company", both
 * balance to zero, and only the label tells them apart.
 */
describe("CONSOLIDATED is not an elimination (14.8)", () => {
  const splitBs = (blocks: Array<[string, number]>) =>
    applyBuColumnSplit(wbWith("BS Actual 2026", makeConsolidated(blocks)), XLSX, {
      sheetName: "BS Actual 2026",
      dataType: "BS",
      planKind: "actual",
      aliasMap,
    })

  it("never routes a CONSOLIDATED block to the elimination writer", () => {
    // Importing the group's totals as eliminations would ADD a second whole
    // balance sheet to the sum instead of subtracting the intercompany
    // balances — and the parser's A + L + E = 0 gate cannot object, because a
    // consolidated balance sheet balances exactly as an elimination block does.
    const out = splitBs([["CPC", 5], ["EDEN", 5], ["CONSOLIDATED", 6]])
    expect(out.sheetMapEntries.some((e) => e.dataType === "BS_ELIMINATIONS")).toBe(false)
    const cons = out.mapping.find((m) => m.buValue === "CONSOLIDATED")
    expect(cons?.action).toBe("skip")
  })

  it("still routes the real EJE block when a CONSOLIDATED block sits beside it", () => {
    const out = splitBs([["CPC", 5], ["EDEN", 5], ["EJE", 4], ["CONSOL", 6]])
    const elim = out.sheetMapEntries.filter((e) => e.dataType === "BS_ELIMINATIONS")
    expect(elim).toHaveLength(1)
    expect(out.mapping.find((m) => m.buValue === "EJE")?.action).toBe("write")
    expect(out.mapping.find((m) => m.buValue === "CONSOL")?.action).toBe("skip")
  })

  it("does not route a management adjustment as an elimination either", () => {
    // AJE is elimination-LIKE and belongs to a real entity (11.83). It must
    // keep going to its owner, not to the group's elimination bucket.
    const out = splitBs([["CPC", 5], ["EDEN", 5], ["AJE", 4]])
    expect(out.sheetMapEntries.some((e) => e.dataType === "BS_ELIMINATIONS")).toBe(false)
  })
})
