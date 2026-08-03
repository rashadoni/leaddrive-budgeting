import { describe, it, expect } from "vitest"
import { cfTargetsHolding, eliminationsCarryEntity } from "./multi-file-orchestrator"

// Codex P1 (2026-06-23): the route-level test alone is too shallow given the
// CF double-layer history. This pins the money-path invariant directly: a
// consolidated cash flow must NEVER resolve to the holding company (it would
// pile up as a "<holding>::" layer that over-counts every org-level CF sum,
// because CashFlowEntry has no companyId/planId).
describe("cfTargetsHolding — CF-on-holding invariant", () => {
  it("refuses a CF dataType that resolves to the holding company code", () => {
    expect(cfTargetsHolding("CF", "AZSEKER", "AZSEKER")).toBe(true)
  })

  it("allows per-company CF (a child code ≠ the holding code)", () => {
    expect(cfTargetsHolding("CF", "AZSEKER-CPC", "AZSEKER")).toBe(false)
    expect(cfTargetsHolding("CF", "AZSEKER-EDEN", "AZSEKER")).toBe(false)
  })

  it("never touches non-CF statements on the holding (BS/PLF budget-on-holding is intentional)", () => {
    expect(cfTargetsHolding("BS", "AZSEKER", "AZSEKER")).toBe(false)
    expect(cfTargetsHolding("PLF", "AZSEKER", "AZSEKER")).toBe(false)
  })

  it("is a no-op without a holding code or an effective entity", () => {
    expect(cfTargetsHolding("CF", "AZSEKER", null)).toBe(false)
    expect(cfTargetsHolding("CF", "AZSEKER", undefined)).toBe(false)
    expect(cfTargetsHolding("CF", null, "AZSEKER")).toBe(false)
  })
})

/**
 * Phase 14.8 — the elimination block must reach the writer with no entity.
 *
 * Same shape and same reasoning as the CF-on-holding invariant above: a
 * dataType that structurally cannot belong to a company, and a cell scan that
 * will happily supply one anyway. The block's labels name ProMalt, CPC, EDEN
 * and QTA; a guess that survives puts −119M of the group's intercompany
 * reversal on one of them.
 */
describe("eliminationsCarryEntity — the elimination block belongs to nobody", () => {
  it("flags an elimination sheet that arrived with an entity", () => {
    expect(eliminationsCarryEntity("BS_ELIMINATIONS", "AZSEKER-CPC")).toBe(true)
    expect(eliminationsCarryEntity("BS_ELIMINATIONS", "AZSEKER")).toBe(true)
  })

  it("is satisfied once the entity is null", () => {
    expect(eliminationsCarryEntity("BS_ELIMINATIONS", null)).toBe(false)
  })

  it("does not touch any other dataType", () => {
    // A normal BS sheet MUST carry its entity — that is the whole point of the
    // BU split. This guard firing there would blank every balance sheet.
    for (const dt of ["BS", "PLF", "CF", "SALES"]) {
      expect(eliminationsCarryEntity(dt, "AZSEKER-CPC"), dt).toBe(false)
    }
  })
})
