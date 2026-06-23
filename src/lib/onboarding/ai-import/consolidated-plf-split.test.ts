import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import fs from "node:fs"
import path from "node:path"
import { splitConsolidatedPlfBlocks } from "./consolidated-plf-split"
import { parsePlfPlSheet } from "../adapters/azseker-plf"

// ── Hermetic unit tests (synthetic workbook) ──────────────────────────
// Real first-of-month Excel serials for 2026 (matches the Reporting-2026 header
// shape so parsePlfPlSheet's findPlfHeaderRow accepts it).
const MONTHS_2026 = [
  46023, 46054, 46082, 46113, 46143, 46174, 46204, 46235, 46266, 46296, 46327,
  46357,
]

function makeBlockSheet(): XLSX.WorkSheet {
  // header row (2 leading + 12 month serials for 2026), then 2 stacked blocks.
  const months = MONTHS_2026
  const header = [null, null, ...months]
  // Block A: revenue leaf 100/mo, an expense leaf 10/mo
  const blockA = [
    ["PLF.01", "REVENUE", ...Array(12).fill(1200)],
    ["PLF.01.01.01", "Rev leaf A", ...Array(12).fill(100)],
    ["PLF.05.01.01", "Exp leaf A", ...Array(12).fill(10)],
    ["PLF.10", "NET", ...Array(12).fill(1080)],
  ]
  // Block B: revenue leaf 50/mo
  const blockB = [
    ["PLF.01", "REVENUE", ...Array(12).fill(600)],
    ["PLF.01.01.01", "Rev leaf B", ...Array(12).fill(50)],
    ["PLF.10", "NET", ...Array(12).fill(600)],
  ]
  return XLSX.utils.aoa_to_sheet([header, ...blockA, ...blockB])
}

describe("splitConsolidatedPlfBlocks — hermetic", () => {
  it("splits a 2-block sheet and computes each block's revenue signature", () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, makeBlockSheet(), "Budget PLF")
    const { blocks, warnings } = splitConsolidatedPlfBlocks(wb, "Budget PLF", XLSX)
    expect(warnings).toEqual([])
    expect(blocks).toHaveLength(2)
    // 12 months × 100 and × 50.
    expect(blocks[0].revenueAnnual).toBe(1200)
    expect(blocks[1].revenueAnnual).toBe(600)
  })

  it("each virtual block parses through parsePlfPlSheet as its own entity sheet", () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, makeBlockSheet(), "Budget PLF")
    const { blocks } = splitConsolidatedPlfBlocks(wb, "Budget PLF", XLSX)
    const wbA = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wbA, blocks[0].worksheet, "blk")
    const parsedA = parsePlfPlSheet(wbA, "blk", XLSX, { preferYear: 2026 })
    // Block A has exactly 2 leaves (revenue + expense); block B's leaves absent.
    const codes = parsedA.lines.map((l) => l.code).sort()
    expect(codes).toEqual(["PLF.01.01.01", "PLF.05.01.01"])
    const rev = parsedA.lines.find((l) => l.code === "PLF.01.01.01")!
    expect(rev.totalAnnual).toBe(1200) // 12 × 100
  })

  it("a single-block sheet yields exactly one block (safe passthrough)", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [null, null, ...MONTHS_2026],
      ["PLF.01", "REVENUE", ...Array(12).fill(1200)],
      ["PLF.01.01.01", "Rev", ...Array(12).fill(100)],
      ["PLF.10", "NET", ...Array(12).fill(1200)],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "PLF CPC")
    const { blocks } = splitConsolidatedPlfBlocks(wb, "PLF CPC", XLSX)
    expect(blocks).toHaveLength(1)
  })
})

// ── Real-file proof (opt-in: slow 26MB parse; run with
//    RUN_REAL_IMPORT_TESTS=1 and the demo workbook present). Kept out of the
//    default suite so the Stop-hook test-gate stays fast; this is the byte-level
//    proof the splitter reproduces the verified per-entity revenues. ──
const REAL = path.resolve(process.cwd(), ".playwright-mcp/_demo/Reporting 2026.xlsx")
const runReal = process.env.RUN_REAL_IMPORT_TESTS === "1" && fs.existsSync(REAL)

describe.runIf(runReal)("splitConsolidatedPlfBlocks — real Reporting 2026.xlsx", () => {
  it("reproduces the verified per-block revenue signatures (EDEN/AZSF/ProMalt/CPC/holding)", () => {
    const wb = XLSX.read(fs.readFileSync(REAL), { cellFormula: false, cellHTML: false })
    const { blocks } = splitConsolidatedPlfBlocks(wb, "Budget PLF", XLSX)
    expect(blocks).toHaveLength(5)
    const revs = blocks.map((b) => Math.round(b.revenueAnnual))
    // Verified against the live DB + _import-baseline.json (2026-06-23).
    expect(revs).toEqual([31986950, 250000, 8308790, 18334363, 0])
    // Σ of all blocks = the verified consolidated Budget PLF revenue (58.88M).
    expect(revs.reduce((a, b) => a + b, 0)).toBe(58880103)
  })

  it("each block parses to leaves via the real parsePlfPlSheet with matching revenue", () => {
    const wb = XLSX.read(fs.readFileSync(REAL), { cellFormula: false, cellHTML: false })
    const { blocks } = splitConsolidatedPlfBlocks(wb, "Budget PLF", XLSX)
    const expected = [31986950, 250000, 8308790, 18334363, 0]
    blocks.forEach((b, i) => {
      const vwb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(vwb, b.worksheet, "blk")
      const parsed = parsePlfPlSheet(vwb, "blk", XLSX, { preferYear: 2026 })
      const rev = parsed.lines
        .filter((l) => l.accountType === "revenue")
        .reduce((s, l) => s + l.totalAnnual, 0)
      expect(Math.round(rev)).toBe(expected[i])
    })
  })
})
