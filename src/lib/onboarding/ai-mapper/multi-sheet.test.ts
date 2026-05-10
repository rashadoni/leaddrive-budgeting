// @vitest-environment node
/**
 * Phase 7.G Turn LXXXXVII (Phase 7.B v2 Day 4) — multi-sheet apply tests.
 */

import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import {
  applyMultiSheetProposal,
  isMultiSheetProposal,
  type MultiSheetProposal,
} from "./applier"
import type { MappingProposal } from "./types"

function makeWorkbookWithSheets(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  return wb
}

function makeProposal(sheetName: string): MappingProposal {
  return {
    sourceFile: "test.xlsx",
    sourceSheet: sheetName,
    summary: "test",
    overallConfidence: 0.9,
    columns: [
      { sourceIndex: 0, role: "code", confidence: 1, reasoning: "code col" },
      { sourceIndex: 1, role: "label", confidence: 1, reasoning: "label" },
      { sourceIndex: 2, role: "amount:Jan", confidence: 1, reasoning: "Jan" },
      { sourceIndex: 3, role: "amount:Feb", confidence: 1, reasoning: "Feb" },
      { sourceIndex: 4, role: "amount:Mar", confidence: 1, reasoning: "Mar" },
      { sourceIndex: 5, role: "amount:Apr", confidence: 1, reasoning: "Apr" },
      { sourceIndex: 6, role: "amount:May", confidence: 1, reasoning: "May" },
      { sourceIndex: 7, role: "amount:Jun", confidence: 1, reasoning: "Jun" },
      { sourceIndex: 8, role: "amount:Jul", confidence: 1, reasoning: "Jul" },
      { sourceIndex: 9, role: "amount:Aug", confidence: 1, reasoning: "Aug" },
      { sourceIndex: 10, role: "amount:Sep", confidence: 1, reasoning: "Sep" },
      { sourceIndex: 11, role: "amount:Oct", confidence: 1, reasoning: "Oct" },
      { sourceIndex: 12, role: "amount:Nov", confidence: 1, reasoning: "Nov" },
      { sourceIndex: 13, role: "amount:Dec", confidence: 1, reasoning: "Dec" },
    ],
    accountTypeOverrides: [],
    anomalies: [],
  }
}

const HEADER_ROW = ["KOD", "Label", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

describe("isMultiSheetProposal", () => {
  it("detects multi-sheet shape", () => {
    expect(isMultiSheetProposal({ sheets: [] })).toBe(true)
  })

  it("detects single-sheet shape (legacy)", () => {
    expect(isMultiSheetProposal(makeProposal("X"))).toBe(false)
  })
})

describe("applyMultiSheetProposal", () => {
  it("loops applyProposal per sheet — happy path", () => {
    const wb = makeWorkbookWithSheets({
      "P&L AAC": [HEADER_ROW, ["601-01", "Sales", 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      "P&L LLS": [HEADER_ROW, ["601-01", "Sales", 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    })
    const multi: MultiSheetProposal = {
      sheets: [
        { sheetName: "P&L AAC", proposal: makeProposal("P&L AAC") },
        { sheetName: "P&L LLS", proposal: makeProposal("P&L LLS") },
      ],
    }
    const out = applyMultiSheetProposal(wb, multi, XLSX)
    expect(out.perSheet).toHaveLength(2)
    expect(out.perSheet[0]).toMatchObject({ sheetName: "P&L AAC" })
    expect(out.perSheet[1]).toMatchObject({ sheetName: "P&L LLS" })
    // Both should have results, no errors
    expect("result" in out.perSheet[0]).toBe(true)
    expect("result" in out.perSheet[1]).toBe(true)
  })

  it("captures per-sheet error without crashing other sheets", () => {
    const wb = makeWorkbookWithSheets({
      "P&L AAC": [HEADER_ROW, ["601-01", "Sales", 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      // "MISSING" sheet not in workbook
    })
    const multi: MultiSheetProposal = {
      sheets: [
        { sheetName: "P&L AAC", proposal: makeProposal("P&L AAC") },
        { sheetName: "MISSING", proposal: makeProposal("MISSING") },
      ],
    }
    const out = applyMultiSheetProposal(wb, multi, XLSX)
    expect(out.perSheet).toHaveLength(2)
    expect("result" in out.perSheet[0]).toBe(true)
    expect("error" in out.perSheet[1]).toBe(true)
    expect((out.perSheet[1] as { error: string }).error).toMatch(/not found in workbook/)
  })

  it("threads userOverridesBySheet into per-sheet apply", () => {
    const wb = makeWorkbookWithSheets({
      "P&L AAC": [HEADER_ROW, ["601-01", "Sales", 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    })
    const multi: MultiSheetProposal = {
      sheets: [{ sheetName: "P&L AAC", proposal: makeProposal("P&L AAC") }],
    }
    // Override accountType for code 601-01 to "expense" (non-default)
    const overrides = {
      "P&L AAC": {
        accountTypeOverrides: [
          { code: "601-01", accountType: "expense" as const, confidence: 1, reasoning: "user-override" },
        ],
      },
    }
    const out = applyMultiSheetProposal(wb, multi, XLSX, overrides)
    expect(out.perSheet).toHaveLength(1)
    expect("result" in out.perSheet[0]).toBe(true)
    // Verify user override took effect
    const res = (out.perSheet[0] as { result: { lines: { code: string; accountType: string }[] } }).result
    expect(res.lines[0].accountType).toBe("expense")
  })

  it("empty sheets array returns empty perSheet", () => {
    const wb = makeWorkbookWithSheets({})
    const out = applyMultiSheetProposal(wb, { sheets: [] }, XLSX)
    expect(out.perSheet).toEqual([])
  })
})
