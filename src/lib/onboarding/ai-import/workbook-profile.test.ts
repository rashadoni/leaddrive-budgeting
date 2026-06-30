import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { extractWorkbookMeta } from "./sheet-meta-extractor"
import {
  buildWorkbookProfile,
  compactWorkbookProfileForClassifier,
} from "./workbook-profile"

function workbook(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return wb
}

describe("buildWorkbookProfile", () => {
  it("detects source, month, actual/budget, BU, and entity signals", () => {
    const wb = workbook({
      "Actual >>>": [],
      "PLF Actual 2026": [
        ["Code", "Label", "Jan", "Feb", "Mar", "BU"],
        ["PLF.01.01.01", "Revenue", 100, 110, 120, "CPC"],
        ["PLF.02.01.01", "COGS", -50, -55, -60, "CPC"],
      ],
      "Budget PLF": [
        ["Code", "Label", "Jan", "Feb", "Mar", "BU"],
        ["PLF.01.01.01", "Revenue", 200, 210, 220, "EDEN"],
      ],
    })
    const metas = extractWorkbookMeta(wb, XLSX)
    const profile = buildWorkbookProfile(wb, XLSX, {
      filename: "actual-budget.xlsx",
      sheetMetas: metas,
      knownEntityCodes: ["AZSEKER-CPC", "AZSEKER-EDEN"],
    })

    expect(profile.workbookPlanHint).toBe("mixed")
    expect(profile.sourceLikeSheets).toBeGreaterThanOrEqual(2)
    expect(profile.monthLikeSheets).toBe(2)
    expect(profile.sheetsWithBuColumns).toBe(2)

    const actual = profile.sheets.find((s) => s.sheetName === "PLF Actual 2026")!
    expect(actual.planHint).toBe("actual")
    expect(actual.roleHint).toBe("source_like")
    expect(actual.monthHeaderCount).toBe(3)
    expect(actual.buColumns).toEqual(["BU"])
    expect(actual.entityLikeValues).toContain("CPC")
  })

  it("flags summary, formula, total, and elimination sheets", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Metric", "Q1 total", "Formula"],
      ["Revenue", 100, { f: "SUM(B2:B2)" }],
      ["Total", 100, { f: "SUM(C2:C2)" }],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, "BS EDEN EJE Pivot")
    const metas = extractWorkbookMeta(wb, XLSX)
    const profile = buildWorkbookProfile(wb, XLSX, {
      filename: "summary.xlsx",
      sheetMetas: metas,
    })

    expect(profile.summaryLikeSheets).toBe(1)
    expect(profile.sheetsWithEliminations).toBe(1)
    expect(profile.sheetsWithFormulas).toBe(1)
    const summary = profile.sheets[0]
    expect(summary.roleHint).toBe("summary_like")
    expect(summary.formulaCells).toBeGreaterThan(0)
    expect(summary.totalRowsCount).toBeGreaterThan(0)
    expect(summary.eliminationSignals.length).toBeGreaterThan(0)
  })

  it("groups duplicate structural fingerprints and exposes compact classifier payload", () => {
    const rows = [
      ["Code", "Label", "Jan", "Feb", "Mar"],
      ["PLF.01.01.01", "Revenue", 100, 110, 120],
      ["PLF.02.01.01", "COGS", -50, -55, -60],
    ]
    const wb = workbook({
      "PLF CPC copy 1": rows,
      "PLF CPC copy 2": rows,
    })
    const metas = extractWorkbookMeta(wb, XLSX)
    const profile = buildWorkbookProfile(wb, XLSX, {
      filename: "dups.xlsx",
      sheetMetas: metas,
    })

    expect(profile.duplicateGroups).toHaveLength(1)
    expect(profile.duplicateGroups[0].sheetNames).toEqual([
      "PLF CPC copy 1",
      "PLF CPC copy 2",
    ])

    const compact = compactWorkbookProfileForClassifier(profile)
    expect(compact.sheets[0]).toMatchObject({
      sheetName: "PLF CPC copy 1",
      roleHint: "source_like",
      duplicateGroupId: "dup-1",
    })
    expect(JSON.stringify(compact)).not.toContain("Revenue")
  })
})
