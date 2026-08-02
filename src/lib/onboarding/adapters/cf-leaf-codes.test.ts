/**
 * 11.72 — the cash-flow parser must not lose a row the way the P&L parser did.
 *
 * `parsePlfCfSheet` decided leafness by the shape of the code — the identical
 * rule that skipped `PLF.09.01` and left 80,000 ₼ on AZSF out of the database
 * under a green `db-readback` verdict, because a row dropped during PARSING
 * never enters the expected set and so agrees with the database perfectly
 * (11.71).
 *
 * **This suite is synthetic, and that is a real limitation, not a formality.**
 * `actual-budget-v1.xlsx` carries no CF sheet and production holds zero
 * `cash_flow_entries`, so unlike 11.70 there is no workbook to measure the
 * claim against. What is tested here is the predicate's behaviour on CF-shaped
 * code sets, including the CF-specific structure the P&L cases cannot cover.
 * What is NOT tested is that any real cash-flow workbook has the shapes below.
 *
 * The direction of risk is bounded: the rule is additive, so nothing that
 * imports today stops importing, and with zero rows in production the blast
 * radius of being wrong is nil. That is why it ships before a workbook exists,
 * and it is the whole of the argument — no more should be read into it.
 */
import { describe, it, expect } from "vitest"
import { buildLeafPredicate, LEAF_CODE_RE } from "./plf-leaf-codes"

describe("cash-flow leafness", () => {
  it("keeps every code the shape rule already accepted", () => {
    // The additive guarantee, stated as a test: this is what makes the change
    // safe to ship against a workbook nobody has seen.
    const codes = ["CF.01.01.01", "CF.01.02.03", "CF.02.01.01", "CF.03.02.AB"]
    const isLeaf = buildLeafPredicate(codes)
    for (const c of codes) {
      expect(LEAF_CODE_RE.test(c), `${c} shape-accepted`).toBe(true)
      expect(isLeaf(c), `${c} still a leaf`).toBe(true)
    }
  })

  it("rescues a direction bucket the sheet breaks nothing out of", () => {
    // The CF analogue of PLF.09.01. `CF.01.01` is the operating INFLOW bucket
    // — three segments, so the old shape rule skipped it. When the file details
    // nothing beneath it, that row is the most specific evidence the workbook
    // contains, and skipping it loses the money outright.
    const isLeaf = buildLeafPredicate([
      "CF.01",
      "CF.01.01",
      "CF.01.02",
      "CF.01.02.01",
      "CF.01.02.02",
    ])
    expect(isLeaf("CF.01.01")).toBe(true)
    // Detailed on the other side, so the bucket itself stays a subtotal.
    expect(isLeaf("CF.01.02")).toBe(false)
    expect(isLeaf("CF.01.02.01")).toBe(true)
  })

  it("never rescues an activity section, however childless", () => {
    // `CF.01` is one numeric segment — the statement section, never a posting
    // row. This is the guard 11.74 had to add after rescuing `PLF.03` and
    // `PLF.08` emitted 34,393,596 AZN of phantom cost.
    expect(buildLeafPredicate(["CF.01"])("CF.01")).toBe(false)
    expect(buildLeafPredicate(["CF.01", "CF.02", "CF.03"])("CF.02")).toBe(false)
  })

  it("refuses to import both a parent and the child already imported", () => {
    // Double-count guard: the ancestor is shape-accepted, so rescuing the
    // deeper code would post the same money twice.
    const isLeaf = buildLeafPredicate(["CF.01.01.01", "CF.01.01.01.02"])
    expect(isLeaf("CF.01.01.01")).toBe(true)
    expect(isLeaf("CF.01.01.01.02")).toBe(false)
  })

  it("treats a namespace suffix as a namespace, not a depth level", () => {
    // `PLF.05.R` looked childless and was the parent of the whole Regions
    // block; importing it double-counted every region. Same code path here.
    //
    // `CF.01.01.01.R` is childless AND excluded, which is not a contradiction:
    // its ancestor `CF.01.01.R` satisfies the four-segment shape rule (`R`
    // counts as the final segment) and is therefore already imported. This is
    // the `PLF.05.01.01.R` case verbatim — the second of the two traps the
    // predicate exists to avoid, and the reason "childless" alone was never
    // sufficient.
    const isLeaf = buildLeafPredicate(["CF.01.R", "CF.01.01.R", "CF.01.01.01.R"])
    expect(isLeaf("CF.01.R"), "the Regions parent must not import").toBe(false)
    expect(isLeaf("CF.01.01.R"), "shape-accepted, imports as before").toBe(true)
    expect(isLeaf("CF.01.01.01.R"), "ancestor already imported").toBe(false)
  })

  it("rescues inside a namespace when no ancestor of it is imported", () => {
    // Same namespace, but the ancestor is a section rather than a shape-
    // accepted leaf, so nothing is imported above this row and the rescue is
    // the only thing standing between the money and the floor.
    const isLeaf = buildLeafPredicate(["CF.01.R", "CF.01.01.R"])
    expect(isLeaf("CF.01.R")).toBe(false)
    expect(isLeaf("CF.01.01.R")).toBe(true)
  })

  it("leaves bridge codes to their own selection, untouched by this rule", () => {
    // CF.04–07 are statement evidence and may legitimately be top-level. The
    // parser exempts them before consulting the predicate at all; this pins
    // that the predicate would otherwise have rejected them, so the exemption
    // is load-bearing and not decoration.
    const isLeaf = buildLeafPredicate(["CF.04", "CF.05", "CF.06", "CF.07"])
    for (const c of ["CF.04", "CF.05", "CF.06", "CF.07"]) {
      expect(isLeaf(c), `${c} would be rejected without the bridge exemption`).toBe(false)
    }
  })
})
