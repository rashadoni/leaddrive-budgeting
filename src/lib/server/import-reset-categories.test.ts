// @vitest-environment node
/**
 * The vocabulary both halves of a delete read from. If these drift, the
 * preview stops describing the reset — which is the failure this whole phase
 * exists to close.
 */
import { describe, it, expect } from "vitest"
import {
  IMPORT_RECORD_GROUPS,
  IMPORT_RESET_CATEGORIES,
  normalizeResetYears,
  resolveResetCategories,
} from "./import-reset-categories"
import { IMPORT_SETTINGS_KEYS } from "./archive"

describe("record groups", () => {
  it("cover every import settings key exactly once", () => {
    // A key the reset deletes but no group names would be destroyed
    // invisibly — the operator would never see it in the blast radius.
    const grouped = Object.values(IMPORT_RECORD_GROUPS).flat()
    expect([...grouped].sort()).toEqual([...IMPORT_SETTINGS_KEYS].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })
})

describe("resolveResetCategories", () => {
  it("defaults to everything when nothing is named", () => {
    expect(resolveResetCategories(undefined)).toEqual(new Set(IMPORT_RESET_CATEGORIES))
    expect(resolveResetCategories([])).toEqual(new Set(IMPORT_RESET_CATEGORIES))
  })

  it("always adds indicators when any source of them is named", () => {
    // Server-side invariant. Clearing the rows an indicator is computed from
    // without clearing the indicator leaves the terminal painting a value
    // derived from data that no longer exists.
    for (const c of [
      "budgetLine",
      "balanceSheetLine",
      "cashFlowEntry",
      "counterparty",
      "operationalFact",
      "budgetActual",
      "salesBudgetLine",
    ]) {
      expect(resolveResetCategories([c]).has("indicatorValue")).toBe(true)
    }
  })

  it("does NOT widen a records-only selection into the numbers", () => {
    expect(resolveResetCategories(["records"])).toEqual(new Set(["records"]))
  })

  it("drops an unknown name instead of failing open", () => {
    // A stale client must never be able to delete MORE than it asked for.
    expect(resolveResetCategories(["balanceSheetLine", "everything"])).toEqual(
      new Set(["balanceSheetLine", "indicatorValue"]),
    )
  })

  it("falls back to everything when every name is unknown", () => {
    expect(resolveResetCategories(["nonsense"])).toEqual(new Set(IMPORT_RESET_CATEGORIES))
  })
})

describe("normalizeResetYears", () => {
  it("prefers years[] and returns it sorted and de-duplicated", () => {
    expect(normalizeResetYears({ year: 2020, years: [2026, 2024, 2026] })).toEqual([
      2024, 2026,
    ])
  })

  it("falls back to the single year, and [] means every year", () => {
    expect(normalizeResetYears({ year: 2026 })).toEqual([2026])
    expect(normalizeResetYears({})).toEqual([])
    expect(normalizeResetYears({ years: [] })).toEqual([])
  })
})
