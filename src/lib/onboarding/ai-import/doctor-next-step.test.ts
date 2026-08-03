import { describe, it, expect } from "vitest"
import { doctorNextStep } from "./doctor-next-step"

describe("doctorNextStep — a route without an LLM round-trip", () => {
  it("sends each blocking issue to the tab that resolves it", () => {
    expect(doctorNextStep("cross_file_conflict")).toMatchObject({
      tab: "conflicts",
      canProceed: false,
    })
    expect(doctorNextStep("coa_review_required")).toMatchObject({
      tab: "coa",
      canProceed: false,
    })
    expect(doctorNextStep("reconciliation_blocked")).toMatchObject({
      tab: "warnings",
      canProceed: false,
    })
  })

  it("marks the advisory issues as safe to proceed", () => {
    // The routing list is 25 sheets of information and reads as a failure
    // unless something says otherwise. This is the field that decides whether
    // an operator presses Apply or waits for permission nobody will give.
    expect(doctorNextStep("routing_uncertain").canProceed).toBe(true)
    expect(doctorNextStep("preview_stale").canProceed).toBe(true)
  })

  it("gives a failed import no tab, because its banner is not behind one", () => {
    expect(doctorNextStep("import_failed")).toMatchObject({
      tab: null,
      canProceed: false,
    })
  })

  it("degrades an unknown code to the receipt, never to a dead end", () => {
    // A new issue type must not produce a panel with no way forward.
    const s = doctorNextStep("something_added_next_year")
    expect(s.tab).toBe("receipt")
    expect(s.key).toBe("generic")
  })

  it("gives every code a distinct sentence key", () => {
    const codes = [
      "cross_file_conflict",
      "coa_review_required",
      "reconciliation_blocked",
      "preview_stale",
      "routing_uncertain",
      "import_failed",
    ]
    const keys = codes.map((c) => doctorNextStep(c).key)
    expect(new Set(keys).size).toBe(codes.length)
    // And none of them falls through to the generic wording.
    expect(keys).not.toContain("generic")
  })
})

describe("the map cannot point somewhere that does not exist", () => {
  // The button label is the TAB's own label, looked up by this key. A tab
  // name that does not exist renders as a missing-translation string on the
  // one control that is supposed to remove confusion.
  const REAL_TABS = [
    "analysis",
    "fixes",
    "coa",
    "conflicts",
    "routing",
    "receipt",
    "warnings",
  ]

  it("every target is a real review tab", () => {
    for (const code of [
      "cross_file_conflict",
      "coa_review_required",
      "reconciliation_blocked",
      "preview_stale",
      "routing_uncertain",
      "import_failed",
      "unknown_code",
    ]) {
      const { tab } = doctorNextStep(code)
      if (tab !== null) expect(REAL_TABS, code).toContain(tab)
    }
  })
})
