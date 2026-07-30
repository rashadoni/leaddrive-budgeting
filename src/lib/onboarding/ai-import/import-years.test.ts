/**
 * Parsing the multi-year import target.
 */
import { describe, it, expect } from "vitest"
import {
  parseImportYears,
  worstVerdict,
  ImportYearsError,
  MAX_YEARS_PER_REQUEST,
} from "./import-years"

const p = (o: Partial<Parameters<typeof parseImportYears>[0]>) =>
  parseImportYears({ fallbackYear: 2026, ...o })

describe("parseImportYears", () => {
  it("falls back to the org year when nothing is supplied", () => {
    expect(p({})).toEqual([2026])
  })

  it("returns a ONE-element list for a single year, not a special case", () => {
    // The single-year path must be the same loop, or it drifts from the
    // multi-year one over time.
    expect(p({ year: "2025" })).toEqual([2025])
  })

  it("parses an explicit list", () => {
    expect(p({ years: "2025,2026" })).toEqual([2025, 2026])
  })

  it("sorts ascending and de-duplicates", () => {
    // Ascending matters: a later year's import must not run before the year it
    // may carry comparatives for.
    expect(p({ years: "2026, 2025 ,2026" })).toEqual([2025, 2026])
  })

  it("expands an inclusive range", () => {
    expect(p({ yearFrom: "2023", yearTo: "2026" })).toEqual([2023, 2024, 2025, 2026])
  })

  it("prefers an explicit list over a range over a single year", () => {
    expect(p({ years: "2024", yearFrom: "2020", yearTo: "2022", year: "2026" })).toEqual([2024])
    expect(p({ yearFrom: "2021", yearTo: "2022", year: "2026" })).toEqual([2021, 2022])
  })

  it("rejects a half-specified range instead of guessing the other end", () => {
    expect(() => p({ yearFrom: "2025" })).toThrow(ImportYearsError)
    expect(() => p({ yearTo: "2025" })).toThrow(/Both 'yearFrom' and 'yearTo'/)
  })

  it("rejects an inverted range", () => {
    expect(() => p({ yearFrom: "2026", yearTo: "2024" })).toThrow(/is after/)
  })

  it("rejects implausible or non-integer years", () => {
    expect(() => p({ years: "26" })).toThrow(ImportYearsError)
    expect(() => p({ years: "2025.5" })).toThrow(ImportYearsError)
    expect(() => p({ years: "2025,abc" })).toThrow(/years/)
    expect(() => p({ year: "1999" })).toThrow(ImportYearsError)
  })

  it("caps the list — each year is a full pipeline run", () => {
    const many = Array.from({ length: MAX_YEARS_PER_REQUEST + 1 }, (_, i) => 2020 + i)
    expect(() => p({ years: many.join(",") })).toThrow(/At most 6 years/)
    // Exactly at the cap is fine.
    expect(p({ years: many.slice(0, MAX_YEARS_PER_REQUEST).join(",") })).toHaveLength(
      MAX_YEARS_PER_REQUEST,
    )
  })

  it("ignores stray whitespace and trailing separators", () => {
    expect(p({ years: " 2025 , 2026 " })).toEqual([2025, 2026])
  })
})

describe("worstVerdict", () => {
  it("one red year makes the whole request red", () => {
    expect(worstVerdict(["green", "red", "green"])).toBe("red")
  })

  it("yellow beats green", () => {
    expect(worstVerdict(["green", "yellow"])).toBe("yellow")
  })

  it("all green is green", () => {
    expect(worstVerdict(["green", "green"])).toBe("green")
  })

  it("no years is green, not a crash", () => {
    expect(worstVerdict([])).toBe("green")
  })
})
