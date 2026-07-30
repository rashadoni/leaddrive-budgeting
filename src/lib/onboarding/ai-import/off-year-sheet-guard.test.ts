/**
 * 2026-07-30 — an off-year sheet must be skipped WITHOUT calling the AI.
 *
 * The failure this closes
 * ───────────────────────
 * The financial handlers treated "the named parser returned 0 rows" as one
 * thing: an unrecognised layout worth a paid dynamic detection. In a
 * multi-year workbook the overwhelmingly common cause is far duller — the
 * sheet is about a DIFFERENT year and the year guard dropped every column.
 *
 * Measured on `actual-budget-v1.xlsx` (PLF Actual 2025 and PLF Actual 2026
 * side by side, split per BU into six off-year sheets per run): one Claude
 * call per off-year sheet, and — when the detector answered below its 0.50
 * confidence floor — a `blocked` result, which the orchestrator's routing gate
 * turns into a refusal of the ENTIRE import. The operator asks for 2026 and
 * the 2025 half of the same file stops the run.
 *
 * These tests drive the real handler with a stub registry-context and assert
 * the dynamic adapter is never reached.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const dynamicMock = vi.hoisted(() => ({
  runDynamicPlfAdapter: vi.fn(async () => ({
    summary: "dynamic ran",
    itemCount: 0,
    warnings: [],
    blocked: { reason: "dynamic PLF detection confidence 0.30 < 0.50" },
    applyToDb: async () => ({ rowsInserted: 0 }),
  })),
  runDynamicBsAdapter: vi.fn(async () => ({
    summary: "dynamic ran",
    itemCount: 0,
    warnings: [],
    applyToDb: async () => ({ rowsInserted: 0 }),
  })),
  runDynamicCfAdapter: vi.fn(async () => ({
    summary: "dynamic ran",
    itemCount: 0,
    warnings: [],
    applyToDb: async () => ({ rowsInserted: 0 }),
  })),
}))

vi.mock("./dynamic-plf-adapter", () => ({
  runDynamicPlfAdapter: dynamicMock.runDynamicPlfAdapter,
}))
vi.mock("./dynamic-bs-adapter", () => ({
  runDynamicBsAdapter: dynamicMock.runDynamicBsAdapter,
}))
vi.mock("./dynamic-cf-adapter", () => ({
  runDynamicCfAdapter: dynamicMock.runDynamicCfAdapter,
}))

import * as XLSX from "xlsx"
import { makePlfHandler } from "./production-adapter-handlers-financial"

/** Real 2025 month serials — the shape the workbook actually ships. */
const M2025 = [45658, 45689, 45717, 45748, 45778, 45809, 45839, 45870, 45901, 45931, 45962, 45992]

function workbookWith2025Plf(): XLSX.WorkBook {
  const aoa: unknown[][] = [
    ["", "", "", ...M2025],
    ["PLF.01.01.01", "Wheat", "", ...Array(12).fill(1000)],
    ["PLF.02.01.01", "COGS Wheat", "", ...Array(12).fill(-400)],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  return { SheetNames: ["PLF Actual 2025"], Sheets: { "PLF Actual 2025": ws } } as XLSX.WorkBook
}

/** A sheet with real content but NO year anywhere — the genuine mystery. */
function workbookWithoutYear(): XLSX.WorkBook {
  const aoa: unknown[][] = [
    ["Product", "Amount"],
    ["Wheat", 100],
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  return { SheetNames: ["Odd layout"], Sheets: { "Odd layout": ws } } as XLSX.WorkBook
}

const ctx = {
  organizationId: "org1",
  year: 2026,
  codeToId: new Map([["AZSEKER-AZSF", "c1"]]),
  planId: "plan1",
  orgCompanies: [{ id: "c1", code: "AZSEKER-AZSF", name: "Azərşəkər" }],
  deptLabelToId: new Map(),
  coaByCode: new Map(),
}

function runHandler(workbook: XLSX.WorkBook, sheetName: string, year: number) {
  const handler = makePlfHandler(
    {} as never,
    { value: ctx as never },
    async () => ctx as never,
  )
  return handler({
    workbook,
    sheetName,
    XLSX,
    year,
    entityCode: "AZSEKER-AZSF",
    filename: "actual-budget-v1.xlsx",
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("off-year sheet guard", () => {
  it("skips a 2025 sheet on a 2026 run WITHOUT calling the dynamic detector", async () => {
    const res = await runHandler(workbookWith2025Plf(), "PLF Actual 2025", 2026)
    // The whole point: no paid call, and no `blocked` to abort the import.
    expect(dynamicMock.runDynamicPlfAdapter).not.toHaveBeenCalled()
    expect(res.itemCount).toBe(0)
    expect((res as { blocked?: unknown }).blocked).toBeUndefined()
  })

  it("says WHICH year the sheet is about, and how to load it", async () => {
    const res = await runHandler(workbookWith2025Plf(), "PLF Actual 2025", 2026)
    const text = res.warnings.join(" ")
    expect(text).toContain("2025")
    expect(text).toContain("2026")
    // The operator needs the way out, not just the diagnosis.
    expect(text).toMatch(/year=2025|import all detected years/)
  })

  it("STILL calls the detector when the sheet names no year at all", async () => {
    // That is the genuine "unrecognised layout" case the fallback exists for;
    // suppressing it would trade one silent drop for another.
    await runHandler(workbookWithoutYear(), "Odd layout", 2026)
    expect(dynamicMock.runDynamicPlfAdapter).toHaveBeenCalledTimes(1)
  })

  it("does not skip when the sheet IS about the requested year", async () => {
    // Same 2025 sheet, now imported as 2025: it must parse, not skip.
    const res = await runHandler(workbookWith2025Plf(), "PLF Actual 2025", 2025)
    expect(dynamicMock.runDynamicPlfAdapter).not.toHaveBeenCalled()
    expect(res.itemCount).toBeGreaterThan(0)
  })
})
