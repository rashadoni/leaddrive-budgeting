/**
 * Phase 11.8b — the producer and the database index must agree.
 *
 * The partial unique index in `20260729190000_budget_line_source_cell_unique`
 * covers only keys matching `#[0-9]+@[0-9]{4}-[0-9]{2}$`. That predicate is not
 * a formality: if the producer ever stops emitting the ordinal, the index does
 * not fail — it silently stops covering new rows and guards nothing. These
 * tests hold the two ends together.
 */
import { describe, it, expect } from "vitest"
import { buildSourceCell, SOURCE_CELL_ORDINAL_RE } from "./source-cell"

const base = {
  channel: "multi-import",
  sheetName: "PLF Actual 2025",
  code: "PLF.07.02.04",
  period: "2025-07",
}

describe("buildSourceCell", () => {
  it("produces a key the index predicate matches", () => {
    const key = buildSourceCell({ ...base, ordinal: 0 })
    expect(key).toBe("multi-import#PLF Actual 2025!PLF.07.02.04#0@2025-07")
    expect(SOURCE_CELL_ORDINAL_RE.test(key)).toBe(true)
  })

  it("distinguishes rows that share a code — the case the old key collapsed", () => {
    // Measured on production: this code appears up to 3× in one sheet, and all
    // three carried an identical key under the old format.
    const keys = [0, 1, 2].map((ordinal) => buildSourceCell({ ...base, ordinal }))
    expect(new Set(keys).size).toBe(3)
  })

  it("keeps the trailing @<period>, which existing readers depend on", () => {
    expect(buildSourceCell({ ...base, ordinal: 4 }).endsWith("@2025-07")).toBe(true)
  })

  it("REJECTS the legacy shape — it is what the index deliberately excludes", () => {
    // Legacy: no ordinal between code and period. Rows carrying this are real
    // data under a key that cannot identify them, so they stay uncovered until
    // a re-import gives them an ordinal.
    const legacy = "multi-import#PLF Actual 2025!PLF.07.02.04@2025-07"
    expect(SOURCE_CELL_ORDINAL_RE.test(legacy)).toBe(false)
  })

  it("does not match a sheet name that is all digits", () => {
    // `multi-import#2025!CODE@2025-07` must not be mistaken for an ordinal key
    // — the digits there are followed by `!`, not `@`.
    expect(SOURCE_CELL_ORDINAL_RE.test("multi-import#2025!PLF.01@2025-07")).toBe(false)
  })
})
