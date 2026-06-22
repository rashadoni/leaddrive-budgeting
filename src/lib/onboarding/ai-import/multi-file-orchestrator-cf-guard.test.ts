import { describe, it, expect } from "vitest"
import { cfTargetsHolding } from "./multi-file-orchestrator"

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
