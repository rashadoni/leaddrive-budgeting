import { describe, expect, it } from "vitest"
import { planKindKey, planLineEvidence, planStatusKey } from "./plan-presentation"

describe("plan presentation truth helpers", () => {
  it("localizes every supported workflow status without rendering raw codes", () => {
    expect(planStatusKey("draft")).toBe("statusDraft")
    expect(planStatusKey("pending_approval")).toBe("statusPending")
    expect(planStatusKey("approved")).toBe("statusApproved")
    expect(planStatusKey("rejected")).toBe("statusRejected")
    expect(planStatusKey("closed")).toBe("statusClosed")
    expect(planStatusKey("unexpected")).toBe("plansStatusUnknown")
  })

  it("keeps plan kind explicit and unknown when source metadata is absent", () => {
    expect(planKindKey("actual")).toBe("plansKindActual")
    expect(planKindKey("budget")).toBe("plansKindBudget")
    expect(planKindKey(undefined)).toBe("plansKindUnknown")
  })

  it("distinguishes a proven empty plan from unavailable count evidence", () => {
    expect(planLineEvidence({ _count: { lines: 12 } })).toEqual({ state: "populated", count: 12 })
    expect(planLineEvidence({ _count: { lines: 0 } })).toEqual({ state: "empty", count: 0 })
    expect(planLineEvidence({})).toEqual({ state: "unknown", count: null })
    expect(planLineEvidence({ _count: { lines: -1 } })).toEqual({ state: "unknown", count: null })
  })
})
