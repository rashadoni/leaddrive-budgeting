/**
 * 11.70 — the codes below are the REAL `PLF.09.*` and `PLF.05.*` families from
 * `actual-budget-v1.xlsx`, read out of the workbook rather than invented. Two
 * of them are traps that a plausible fix falls into, and both would put money
 * in the database twice.
 */
import { describe, it, expect } from "vitest"
import { buildLeafPredicate, LEAF_CODE_RE } from "./plf-leaf-codes"

/** Verbatim from `PLF Budget 2026`, column A. */
const PLF_09 = [
  "PLF.09.01", // ← the dropped one: NO children, unlike every sibling
  "PLF.09.02",
  "PLF.09.02.01",
  "PLF.09.02.02",
  "PLF.09.02.03",
  "PLF.09.02.99",
  "PLF.09.03",
  "PLF.09.03.01",
  "PLF.09.03.09",
  "PLF.09.04",
  "PLF.09.04.01",
  "PLF.09.04.02",
]

/** The Regions namespace: `.R` is a SUFFIX, not another depth level. */
const PLF_05_R = [
  "PLF.05.R", // parent of the whole R namespace
  "PLF.05.01.R", // imported today by the shape rule
  "PLF.05.01.01.R", // its child — must NOT also be imported
  "PLF.05.02.R",
  "PLF.05.02.01.R",
]

describe("buildLeafPredicate — the defect", () => {
  it("rescues PLF.09.01, the childless three-segment code that lost 80,000 AZN", () => {
    // The whole reason this file exists. Depth said "subtotal"; the sheet says
    // nothing descends from it.
    const isLeaf = buildLeafPredicate(PLF_09)
    expect(LEAF_CODE_RE.test("PLF.09.01")).toBe(false) // the old rule rejected it
    expect(isLeaf("PLF.09.01")).toBe(true)
  })

  it("still refuses its siblings, which really are subtotals", () => {
    const isLeaf = buildLeafPredicate(PLF_09)
    for (const parent of ["PLF.09.02", "PLF.09.03", "PLF.09.04"]) {
      expect(isLeaf(parent)).toBe(false)
    }
    for (const leaf of ["PLF.09.02.01", "PLF.09.03.09", "PLF.09.04.02"]) {
      expect(isLeaf(leaf)).toBe(true)
    }
  })
})

describe("buildLeafPredicate — the two double-counting traps", () => {
  it("does NOT rescue PLF.05.R — `.R` is a namespace suffix, so it is a parent", () => {
    // Trap one. A naive "no code starts with PLF.05.R." search finds no
    // children and would import the Regions grand total ON TOP of every
    // region — the sheet's entire G&A block, twice.
    const isLeaf = buildLeafPredicate(PLF_05_R)
    expect(isLeaf("PLF.05.R")).toBe(false)
  })

  it("does NOT rescue a child whose ancestor is already imported", () => {
    // Trap two. `PLF.05.01.01.R` is genuinely childless, but `PLF.05.01.R` is
    // accepted by the shape rule and already carries its money.
    const isLeaf = buildLeafPredicate(PLF_05_R)
    expect(LEAF_CODE_RE.test("PLF.05.01.R")).toBe(true)
    expect(isLeaf("PLF.05.01.R")).toBe(true)
    expect(isLeaf("PLF.05.01.01.R")).toBe(false)
  })

  it("keeps the Regions total equal to the sum of its parts — no double count", () => {
    // The property that actually matters: exactly one level of the R
    // namespace is imported.
    const isLeaf = buildLeafPredicate(PLF_05_R)
    const imported = PLF_05_R.filter(isLeaf)
    expect(imported).toEqual(["PLF.05.01.R", "PLF.05.02.R"])
  })
})

describe("buildLeafPredicate — nothing that works today stops working", () => {
  it("accepts every code the shape rule accepted", () => {
    // The change is purely additive. A code imported before this fix must
    // still be imported after it, or the fix trades one silent loss for
    // another.
    const codes = [...PLF_09, ...PLF_05_R, "PLF.01.01.01", "CF.01.01.02", "PLF.02.01.99"]
    const isLeaf = buildLeafPredicate(codes)
    for (const c of codes) {
      if (LEAF_CODE_RE.test(c)) expect(isLeaf(c)).toBe(true)
    }
  })

  it("never rescues a computed total like PLF.03 / PLF.08 / PLF.10", () => {
    // 11.74 — this assertion is unchanged; its FIXTURE was the bug.
    //
    // It used to supply `PLF.03.01.01` and `PLF.10.01.01` as children, so the
    // descendant rule excluded the parents and the test passed for a reason
    // that does not hold in the file. Read out of `actual-budget-v1.xlsx`,
    // GROSS MARGIN / EBITDA / NET PROFIT have ZERO children in every PLF
    // sheet — nothing is broken out beneath them, they simply state the
    // section's computed total. Childlessness cannot tell them apart from a
    // real account; depth can.
    const isLeaf = buildLeafPredicate([
      "PLF.02.01.01",
      "PLF.03", // GROSS MARGIN — childless, all three sheets
      "PLF.08", // EBITDA — childless in the 2026 chart of accounts
      "PLF.10", // NET PROFIT / (LOSS) — childless everywhere
    ])
    expect(isLeaf("PLF.03")).toBe(false)
    expect(isLeaf("PLF.08")).toBe(false)
    expect(isLeaf("PLF.10")).toBe(false)
    expect(isLeaf("PLF.02.01.01")).toBe(true)
  })

  it("still rescues PLF.08.01 — a real account under a section, not the section", () => {
    // The 2025 chart of accounts codes Shareholders' expense as `PLF.08.01`
    // (174,491 AZN, AZSF actual). It is three segments and childless, so it
    // is exactly the case 11.70 exists to recover — and the depth guard must
    // not take it back. In 2025 `PLF.08` itself HAS children, so the section
    // is excluded by the descendant rule rather than by depth.
    const isLeaf = buildLeafPredicate([
      "PLF.08",
      "PLF.08.01", // Shareholders' expense
      "PLF.08.02", // Expenses of prior periods
      "PLF.08.03", // EDEN adjustment
    ])
    expect(isLeaf("PLF.08")).toBe(false)
    expect(isLeaf("PLF.08.01")).toBe(true)
    expect(isLeaf("PLF.08.02")).toBe(true)
    expect(isLeaf("PLF.08.03")).toBe(true)
  })

  it("refuses every one-segment section, populated or not", () => {
    // The whole PLF.NN family from the real 2026 sheet. Sections with detail
    // beneath them were already excluded; the childless ones are the ones
    // that leaked. Neither kind is a posting account.
    const sections = ["PLF.01", "PLF.02", "PLF.03", "PLF.04", "PLF.05", "PLF.07", "PLF.08", "PLF.10", "PLF.12"]
    const isLeaf = buildLeafPredicate([...sections, "PLF.01.01.01", "PLF.12.01.01"])
    for (const s of sections) {
      expect(isLeaf(s), `${s} must never be imported`).toBe(false)
    }
  })

  it("handles a one-code sheet and an empty one without inventing leaves", () => {
    expect(buildLeafPredicate([])("PLF.09.01")).toBe(false)
    expect(buildLeafPredicate(["PLF.09.01"])("PLF.09.01")).toBe(true)
  })

  it("ignores malformed entries rather than crashing a parse", () => {
    const isLeaf = buildLeafPredicate([
      "",
      null as unknown as string,
      "PLF.09.01",
    ])
    expect(isLeaf("PLF.09.01")).toBe(true)
  })
})
