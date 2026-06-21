// @vitest-environment node
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseCourtDisputes, attributeCompanies } from "./court-disputes-parse"

// cols: num | date | court | claimant | defendant | disputeType | caseDesc | dept | lawyer | status
function wb(rows: unknown[][]): XLSX.WorkBook {
  const aoa = [["H"], ["H"], ["H"], ...rows] // 3 header rows, data from idx 3
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, "Məhkəmə mübahisələri")
  return book
}

describe("parseCourtDisputes", () => {
  it("attributes a case to the entity in claimant/defendant and counts open/defendant", () => {
    const r = parseCourtDisputes(
      wb([[1, "2026-01", "Bakı", "ATS", "CPC MMC", "mülki", "desc", "", "", "davam edir"]]),
      "Məhkəmə mübahisələri",
      XLSX,
    )
    expect(r.byCompany["AZSEKER-CPC"]).toMatchObject({ total: 1, open: 1, as_defendant: 1, as_plaintiff: 0 })
  })

  it("marks a case closed on an Azerbaijani closed-keyword, and counts plaintiff", () => {
    const r = parseCourtDisputes(
      wb([[1, "2026-02", "Bakı", "Azərşəkər", "X firm", "mülki", "desc", "", "", "icraata xitam verilib"]]),
      "Məhkəmə mübahisələri",
      XLSX,
    )
    expect(r.byCompany["AZSEKER-AZSF"]).toMatchObject({ total: 1, open: 0, as_plaintiff: 1 })
  })

  it("counts money claims and attributes to BOTH entities named", () => {
    const r = parseCourtDisputes(
      wb([[1, "2026-03", "Bakı", "CPC", "Eden Agro", "pul tələbi", "borc", "", "", "davam edir"]]),
      "Məhkəmə mübahisələri",
      XLSX,
    )
    expect(r.byCompany["AZSEKER-CPC"].money_claims).toBe(1)
    expect(r.byCompany["AZSEKER-EDEN"].money_claims).toBe(1)
  })

  it("skips a row attributable to no entity", () => {
    const r = parseCourtDisputes(
      wb([[1, "2026-04", "Bakı", "Foo LLC", "Bar LLC", "mülki", "desc", "", "", "davam edir"]]),
      "Məhkəmə mübahisələri",
      XLSX,
    )
    expect(Object.keys(r.byCompany)).toHaveLength(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})

describe("attributeCompanies", () => {
  it("matches CPC before the broad Azərşəkər root, multi-entity aware", () => {
    expect(attributeCompanies("CPC MMC", "Azərşəkər").sort()).toEqual(["AZSEKER-AZSF", "AZSEKER-CPC"])
    expect(attributeCompanies("Eden Agro", "")).toEqual(["AZSEKER-EDEN"])
    expect(attributeCompanies("Unknown", "Other")).toEqual([])
  })
})
