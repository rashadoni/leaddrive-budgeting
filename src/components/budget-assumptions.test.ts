/**
 * Sub-44 cont'd architectural-debt closure (sub-38 architect ⚠️) —
 * tests for the consolidated `CATEGORY_META` map + `getCategoryMeta`
 * lookup helper. Replaces the prior 3 parallel `Record<string, string>`
 * maps (CATEGORY_LABELS / CATEGORY_COLORS / CATEGORY_ICONS) which were
 * prone to drift on every data-shape extension (sub-35 was the first
 * miss, sub-38 was the second).
 *
 * Why these tests matter: the new shape's TypeScript type forces every
 * entry to declare label + color + icon at compile time. The runtime
 * tests below add belt-and-braces:
 *   - Every entry has all 3 non-empty fields (catches accidental "")
 *   - Every expected category code is present (catches accidental drop)
 *   - Helper falls back gracefully for unknown codes (mirrors legacy
 *     `|| cat` / `|| "#9ca3af"` / `|| "📋"` semantics)
 *   - Color values are valid hex codes (catches typos like "#zzz")
 *
 * Imports the constants directly from the .tsx file — Vitest can read
 * non-React exports from a "use client" component without any module
 * mocking.
 */

import { describe, it, expect } from "vitest"
import {
  CATEGORY_META,
  DEFAULT_CATEGORY_META,
  getCategoryMeta,
  type CategoryMeta,
} from "./budget-assumptions"

const LEGACY_AAC_CODES = [
  "returns_transport",
  "mhb_transport",
  "pallet_export",
  "waste",
  "food",
  "prepaid",
  "utilities",
  "mining",
  "repair",
  "mhb_recipe",
  "labor_base",
  "labor_summary",
  "marketing",
  "depreciation",
  "other",
] as const

const FPA_CODES = [
  "operations",
  "commercial",
  "finance",
  "fx",
  "hr",
  "pricing",
  "risk",
  "tax",
  "inflation",
] as const

describe("CATEGORY_META invariants (sub-38 ⚠️ closure via consolidation)", () => {
  it("every entry has all 3 fields (label, color, icon) populated + non-empty", () => {
    // The TypeScript type already enforces presence at compile time.
    // This runtime check catches accidental empty strings (e.g. a
    // refactor that comments out a value but leaves the key).
    for (const [code, meta] of Object.entries(CATEGORY_META)) {
      expect(meta.label, `${code}.label is empty`).toBeTruthy()
      expect(meta.color, `${code}.color is empty`).toBeTruthy()
      expect(meta.icon, `${code}.icon is empty`).toBeTruthy()
    }
  })

  it("every legacy AAC product-line code is present (back-compat with original prototype data)", () => {
    for (const code of LEGACY_AAC_CODES) {
      expect(
        CATEGORY_META[code],
        `legacy AAC code "${code}" is missing — would fall back to gray + cat-as-label`,
      ).toBeDefined()
    }
  })

  it("every FP&A holding-wide code is present (sub-38 closure — was missed pre-consolidation)", () => {
    for (const code of FPA_CODES) {
      expect(
        CATEGORY_META[code],
        `FP&A code "${code}" is missing — sub-38 architect ⚠️ regression`,
      ).toBeDefined()
    }
  })

  it("every color is a valid hex string (#RRGGBB or #RRGGBBAA)", () => {
    // Catches typos like "#zzz" or "rgba(...)" that would render as
    // black in some browsers + grey in others. Locks the wire format.
    const hexPattern = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/
    for (const [code, meta] of Object.entries(CATEGORY_META)) {
      expect(meta.color, `${code}.color "${meta.color}" is not a valid hex`).toMatch(hexPattern)
    }
  })

  it("DEFAULT_CATEGORY_META has the legacy gray-fallback color + 📋 icon", () => {
    expect(DEFAULT_CATEGORY_META.color).toBe("#9ca3af")
    expect(DEFAULT_CATEGORY_META.icon).toBe("📋")
  })

  it("entry count matches the union of LEGACY_AAC_CODES + FPA_CODES exactly (no surprise extras)", () => {
    // Drift guard: if a future refactor adds a category to the map
    // without updating these test arrays, the test fails — forces the
    // contributor to acknowledge the new code in the test suite too.
    const expected = new Set([...LEGACY_AAC_CODES, ...FPA_CODES])
    const actual = new Set(Object.keys(CATEGORY_META))
    expect(actual).toEqual(expected)
  })
})

describe("getCategoryMeta — safe lookup with fallback (sub-44 cont'd)", () => {
  it("returns the registered entry for a known category", () => {
    const meta = getCategoryMeta("operations")
    expect(meta).toEqual<CategoryMeta>({
      label: "Operations",
      color: "#3b82f6",
      icon: "⚙️",
    })
  })

  it("returns the raw cat code as label + default color/icon for unknown codes", () => {
    // Mirrors the legacy `|| cat` / `|| "#9ca3af"` / `|| "📋"` behavior
    // — a NEW category code surfaced by data MUST render visibly even
    // if the map hasn't been updated yet. Gray-stripe + 📋 + raw code
    // is a recognizable "needs attention" UX signal.
    const meta = getCategoryMeta("brand_new_category_no_one_added_yet")
    expect(meta.label).toBe("brand_new_category_no_one_added_yet")
    expect(meta.color).toBe("#9ca3af")
    expect(meta.icon).toBe("📋")
  })

  it("does NOT mutate DEFAULT_CATEGORY_META when synthesizing fallback (defensive)", () => {
    // Without `{...DEFAULT_CATEGORY_META, label: cat}` spread the
    // helper would assign back into the shared singleton. Lock the
    // immutability contract.
    const before = { ...DEFAULT_CATEGORY_META }
    getCategoryMeta("first_unknown_cat")
    getCategoryMeta("second_unknown_cat")
    expect(DEFAULT_CATEGORY_META).toEqual(before)
  })

  it("two lookups for the same unknown code return independent objects (no aliasing)", () => {
    const a = getCategoryMeta("unknown_x")
    const b = getCategoryMeta("unknown_x")
    expect(a).toEqual(b)
    expect(a).not.toBe(b) // distinct object refs — safe to mutate without bleeding
  })
})
