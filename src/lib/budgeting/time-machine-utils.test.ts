import { describe, it, expect } from "vitest"
import { getChangedCells, getFlashClass, formatTimePoint } from "./time-machine-utils"

/**
 * Pure-helper coverage for time-machine-utils.ts.
 *
 * Time-machine drives the budgeting page's "compare-to-previous" UX —
 * highlights cells that changed since a prior snapshot. Diff
 * correctness matters: a stale-cells map silently misleads users
 * about what really changed.
 */

describe("getChangedCells", () => {
  it("returns empty map when no diffs", () => {
    const lines = [{ id: "l1", plannedAmount: 100, forecastAmount: 95, category: "Rent" }]
    const m = getChangedCells(lines, lines, [], [])
    expect(m.size).toBe(0)
  })

  it("detects plannedAmount increase → 'increase'", () => {
    const prev = [{ id: "l1", plannedAmount: 100, forecastAmount: 0, category: "Rent" }]
    const curr = [{ id: "l1", plannedAmount: 150, forecastAmount: 0, category: "Rent" }]
    const m = getChangedCells(prev, curr, [], [])
    expect(m.get("line:l1:plannedAmount")).toBe("increase")
  })

  it("detects plannedAmount decrease → 'decrease'", () => {
    const prev = [{ id: "l1", plannedAmount: 100, forecastAmount: 0, category: "Rent" }]
    const curr = [{ id: "l1", plannedAmount: 80, forecastAmount: 0, category: "Rent" }]
    const m = getChangedCells(prev, curr, [], [])
    expect(m.get("line:l1:plannedAmount")).toBe("decrease")
  })

  it("detects new line (no prev entry) → 'other'", () => {
    const prev: any[] = []
    const curr = [{ id: "l-new", plannedAmount: 50, forecastAmount: 0, category: "Travel" }]
    const m = getChangedCells(prev, curr, [], [])
    expect(m.get("line:l-new:plannedAmount")).toBe("other")
  })

  it("detects deleted line → 'decrease' (line:<id>:deleted key)", () => {
    const prev = [{ id: "l-gone", plannedAmount: 100, forecastAmount: 0, category: "Old" }]
    const curr: any[] = []
    const m = getChangedCells(prev, curr, [], [])
    expect(m.get("line:l-gone:deleted")).toBe("decrease")
  })

  it("detects category rename → 'other' (semantic, neither up nor down)", () => {
    // Phase 2.1 session 3: category column dropped; reclassification is now
    // detected by accountId change (CoA FK swap).
    const prev = [{ id: "l1", plannedAmount: 100, forecastAmount: 0, accountId: "coa_old" }]
    const curr = [{ id: "l1", plannedAmount: 100, forecastAmount: 0, accountId: "coa_new" }]
    const m = getChangedCells(prev, curr, [], [])
    expect(m.get("line:l1:account")).toBe("other")
  })

  it("aggregates actuals per (category, lineType) and detects shifts", () => {
    const prevActuals = [
      { category: "Rent", lineType: "expense", actualAmount: 500 },
      { category: "Rent", lineType: "expense", actualAmount: 200 }, // same key → 700 total
    ]
    const currActuals = [
      { category: "Rent", lineType: "expense", actualAmount: 1000 }, // up from 700
    ]
    const m = getChangedCells([], [], prevActuals, currActuals)
    expect(m.get("actual:Rent||expense")).toBe("increase")
  })

  it("detects actuals appearing for the first time as 'increase'", () => {
    const currActuals = [
      { category: "Travel", lineType: "expense", actualAmount: 250 },
    ]
    const m = getChangedCells([], [], [], currActuals)
    expect(m.get("actual:Travel||expense")).toBe("increase")
  })

  it("detects actuals disappearing as 'decrease'", () => {
    const prevActuals = [{ category: "Old", lineType: "expense", actualAmount: 500 }]
    const m = getChangedCells([], [], prevActuals, [])
    expect(m.get("actual:Old||expense")).toBe("decrease")
  })
})

describe("getFlashClass", () => {
  it("returns green class for 'increase'", () => {
    expect(getFlashClass("increase")).toBe("animate-budget-flash-green")
  })

  it("returns red class for 'decrease'", () => {
    expect(getFlashClass("decrease")).toBe("animate-budget-flash-red")
  })

  it("returns yellow class for 'other' (neutral changes)", () => {
    expect(getFlashClass("other")).toBe("animate-budget-flash-yellow")
  })
})

describe("formatTimePoint", () => {
  // Anchor times use UTC noon to avoid date-wrapping when the test
  // host is in a non-UTC timezone (e.g., Asia/Baku UTC+4 would push
  // a 23:59Z timestamp into the next local day).
  it("formats ISO timestamp to short month + day + HH:MM", () => {
    const formatted = formatTimePoint("2026-05-17T12:00:00Z")
    // Should contain "May" + "17" + ":" (colon between HH and MM)
    expect(formatted).toMatch(/May.*17/)
    expect(formatted).toContain(":")
  })

  it("handles different months", () => {
    expect(formatTimePoint("2026-01-05T12:00:00Z")).toMatch(/Jan.*5/)
    expect(formatTimePoint("2026-12-15T12:00:00Z")).toMatch(/Dec.*15/)
  })
})
