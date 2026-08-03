import { describe, it, expect } from "vitest"
import { chooseReconciliationBlockedMessage } from "./reconciliation-blocked-message"

describe("chooseReconciliationBlockedMessage", () => {
  it("says the check did not RUN when nothing was verified either way", () => {
    // The production case, 2026-08-03. Zero verified AND zero unverified means
    // no group was formed — not a mismatch. Telling an operator their numbers
    // disagree when nothing was compared is the more alarming of the two
    // wrong answers.
    expect(
      chooseReconciliationBlockedMessage({
        sheetsVerified: 0,
        sheetsUnverified: 0,
        unverifiedSheetNames: [],
        allCommittedGroupsVerified: false,
      }),
    ).toEqual({ key: "reconciliationBlockedNothingChecked" })
  })

  it("names the counts when sheets were checked and disagreed", () => {
    const c = chooseReconciliationBlockedMessage({
      sheetsVerified: 3,
      sheetsUnverified: 2,
      unverifiedSheetNames: ["Tech", "İcmal"],
      allCommittedGroupsVerified: false,
    })
    expect(c.key).toBe("reconciliationBlockedDrifted")
    expect(c.params).toEqual({
      verified: 3,
      total: 5,
      unverified: 2,
      names: "Tech, İcmal",
    })
  })

  it("counts a verified-only run as checked, not as an absent check", () => {
    // 4 verified / 0 unverified is a real reconciliation that came back red.
    const c = chooseReconciliationBlockedMessage({
      sheetsVerified: 4,
      sheetsUnverified: 0,
      allCommittedGroupsVerified: true,
    })
    expect(c.key).toBe("reconciliationBlockedDrifted")
    expect(c.params).toMatchObject({ verified: 4, total: 4, unverified: 0 })
  })

  it("caps the sheet list instead of pasting twenty names into a sentence", () => {
    const c = chooseReconciliationBlockedMessage({
      sheetsVerified: 1,
      sheetsUnverified: 6,
      unverifiedSheetNames: ["a", "b", "c", "d", "e", "f"],
      allCommittedGroupsVerified: false,
    })
    expect(c.params?.names).toBe("a, b, c, d")
    // The count still reports all six — the list is trimmed, not the fact.
    expect(c.params?.unverified).toBe(6)
  })

  it("uses a dash rather than empty brackets when no names came through", () => {
    const c = chooseReconciliationBlockedMessage({
      sheetsVerified: 2,
      sheetsUnverified: 1,
      allCommittedGroupsVerified: false,
    })
    expect(c.params?.names).toBe("—")
  })

  it("falls back to the original wording when a receipt carries no evidence", () => {
    // A receipt from a deployment older than Phase 11.2. Inventing counts for
    // it would be worse than the vague sentence.
    expect(chooseReconciliationBlockedMessage(null)).toEqual({
      key: "reconciliationBlocked",
    })
    expect(chooseReconciliationBlockedMessage(undefined)).toEqual({
      key: "reconciliationBlocked",
    })
  })
})
