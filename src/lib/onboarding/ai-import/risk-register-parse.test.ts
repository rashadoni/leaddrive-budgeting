// @vitest-environment node
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseRiskRegister } from "./risk-register-parse"

function wb(rows: unknown[][]): XLSX.WorkBook {
  const header = ["Level 1", "Level 2", "Level 3", "KRI", "Criticality(1-2-3)", "L3 description", "Note"]
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, "Azerseker")
  return book
}

describe("parseRiskRegister", () => {
  it("parses the KRI taxonomy and buckets by criticality", () => {
    const r = parseRiskRegister(
      wb([
        ["Environmental", "Climate change", "Drought", "Days >40°C", 3, "Heat stress", "note"],
        ["Financial", "Liquidity", "Cash flow", "Current ratio", 2, "desc", ""],
        ["Financial", "Macro", "Commodity", "Price vol", 3, "desc", ""],
      ]),
      "Azerseker",
      XLSX,
    )
    expect(r.risks).toHaveLength(3)
    expect(r.risks[0]).toMatchObject({
      level1: "Environmental",
      level2: "Climate change",
      level3: "Drought",
      kri: "Days >40°C",
      criticality: 3,
    })
    expect(r.byCriticality).toEqual({ "3": 2, "2": 1 })
  })

  it("locates columns by header text (robust to a leading index column)", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["#", "Level 1", "Level 2", "Level 3", "KRI", "Criticality", "Description", "Note"],
      [1, "Ops", "Supply", "Single source", "Supplier count", 2, "d", "n"],
    ])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, ws, "S")
    const r = parseRiskRegister(book, "S", XLSX)
    expect(r.risks[0]).toMatchObject({ level1: "Ops", level3: "Single source", criticality: 2 })
  })

  it("skips wholly-empty rows and warns on an empty sheet", () => {
    const r = parseRiskRegister(wb([["", "", "", "", "", "", ""]]), "Azerseker", XLSX)
    expect(r.risks).toHaveLength(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it("tolerates a non-numeric criticality (→ null, not in buckets)", () => {
    const r = parseRiskRegister(wb([["Env", "X", "Y", "kri", "high", "d", ""]]), "Azerseker", XLSX)
    expect(r.risks[0].criticality).toBeNull()
    expect(r.byCriticality).toEqual({})
  })
})
