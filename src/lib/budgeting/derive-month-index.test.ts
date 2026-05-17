import { describe, it, expect } from "vitest"
import { deriveMonthIndex } from "./derive-month-index"

describe("deriveMonthIndex", () => {
  it("parses YYYY-MM-DD → month - 1", () => {
    expect(deriveMonthIndex("2026-01-15")).toBe(0)
    expect(deriveMonthIndex("2026-12-31")).toBe(11)
    expect(deriveMonthIndex("2026-07-04")).toBe(6)
  })

  it("parses YYYY-M-D (single-digit month/day)", () => {
    expect(deriveMonthIndex("2026-1-1")).toBe(0)
    expect(deriveMonthIndex("2026-7-4")).toBe(6)
  })

  it("parses YYYY/MM/DD (slash separator)", () => {
    expect(deriveMonthIndex("2026/03/15")).toBe(2)
  })

  it("parses YYYY-MM without day", () => {
    expect(deriveMonthIndex("2026-05")).toBe(4)
  })

  it("returns null for null/undefined/empty/non-string", () => {
    expect(deriveMonthIndex(null)).toBeNull()
    expect(deriveMonthIndex(undefined)).toBeNull()
    expect(deriveMonthIndex("")).toBeNull()
    // @ts-expect-error guard against runtime non-string
    expect(deriveMonthIndex(42)).toBeNull()
  })

  it("returns null for unparseable strings", () => {
    expect(deriveMonthIndex("not a date")).toBeNull()
    expect(deriveMonthIndex("Q1 2026")).toBeNull()
    expect(deriveMonthIndex("January 15, 2026")).toBeNull()
  })

  it("returns null for out-of-range month", () => {
    expect(deriveMonthIndex("2026-00-01")).toBeNull()
    expect(deriveMonthIndex("2026-13-01")).toBeNull()
    expect(deriveMonthIndex("2026-99-01")).toBeNull()
  })
})
