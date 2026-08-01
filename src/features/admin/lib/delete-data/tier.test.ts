// @vitest-environment node
/**
 * The confirmation gate, and the one structural rule the old panel lacked:
 * the widest scope must not be reachable by mutating a narrow one.
 */
import { describe, it, expect } from "vitest"
import { canSubmit, gateFor, isHardStop, WIDEST_TOKEN } from "./tier"
import { buildCommitRequest } from "./payload"
import { expectedConfirmCode } from "@/lib/server/delete-request"

const base = {
  task: "clearYears" as const,
  companyCodes: ["AZSEKER-CPC"],
  allYears: false,
  hasPermanent: false,
}

const MANY = ["AZSEKER-CPC", "AZSEKER-EDEN"]

describe("gateFor", () => {
  it("asks for the COMPANY CODE when exactly one company and named years", () => {
    // "ALL" for a one-company delete taught the hand to type "ALL" for
    // everything. The code says which company you mean.
    expect(gateFor(base)).toMatchObject({ tier: 1, token: "AZSEKER-CPC" })
  })

  it("escalates to ALL for two or more companies", () => {
    expect(gateFor({ ...base, companyCodes: MANY })).toMatchObject({
      tier: 2,
      token: WIDEST_TOKEN,
    })
  })

  it("keeps the COMPANY CODE at Tier 2 when the body still names one company", () => {
    // The escalation to Tier 2 is real (longer reason, no chips) but it must
    // NOT change the string: the route derives what it demands from the very
    // body this scope produces, and that body carries `companyCode`. Asking
    // for "ALL" here is what made "Remove one company" a guaranteed 400.
    for (const wider of [{ allYears: true }, { hasPermanent: true }]) {
      const gate = gateFor({ ...base, ...wider })
      expect(gate.tier).toBe(2)
      expect(gate.token).toBe("AZSEKER-CPC")
      expect(gate.minReason).toBeGreaterThan(gateFor(base).minReason)
      expect(gate.reasonChips).toBe(false)
    }
  })

  it("gives Task D a longer reason, no chips and a five-second arm", () => {
    expect(gateFor({ ...base, task: "deleteAll", companyCodes: MANY })).toEqual({
      tier: 3,
      token: "ALL",
      minReason: 10,
      reasonChips: false,
      armMs: 5000,
    })
  })

  it("never returns a tier without a typed token", () => {
    for (const scope of [
      base,
      { ...base, companyCodes: MANY },
      { ...base, task: "deleteAll" as const },
    ]) {
      expect(gateFor(scope).token.length).toBeGreaterThan(0)
      expect(gateFor(scope).minReason).toBeGreaterThan(0)
    }
  })
})

describe("gateFor ↔ the request it will send", () => {
  // The pure half of the client/server agreement. The other half — the real
  // POST handler answering 200 — is pinned in
  // `src/app/api/admin/data-archive/handler.test.ts`.
  const shapes: string[][] = [
    ["AZSEKER-CPC"],
    ["AZSEKER-CPC", "AZSEKER-EDEN"],
    ["A", "B", "C", "D"],
    ["AZSEKER-CPC", "AZSEKER-CPC"], // a duplicate still names one company
  ]

  it("asks for exactly what the route will compute from the same body", () => {
    for (const task of ["clearYears", "removeCompany", "deleteAll"] as const) {
      for (const companyCodes of shapes) {
        for (const allYears of [true, false]) {
          const gate = gateFor({ ...base, task, companyCodes, allYears })
          const body = buildCommitRequest({
            task,
            companyCodes,
            years: allYears ? [] : [2026],
            bundle: "everything",
            exactCategories: null,
            includeManualActuals: false,
            reason: "the file was wrong",
            confirmToken: gate.token,
            expectRows: 10,
          })
          expect(expectedConfirmCode(body)).toBe(gate.token)
          expect(body.confirmCode).toBe(expectedConfirmCode(body))
        }
      }
    }
  })
})

describe("isHardStop", () => {
  it("fires when a narrow task is widened by hand into the widest scope", () => {
    // The exact failure this codebase has today: the old panel's whole-holding
    // scope plus a blanked year box IS a full wipe, wearing the wording,
    // colour and confirmation of a routine cleanup.
    expect(
      isHardStop({
        task: "clearYears",
        selectedCompanies: 27,
        totalCompanies: 27,
        allYears: true,
      }),
    ).toBe(true)
  })

  it("ALSO fires when every year is named one chip at a time", () => {
    // The hole this test used to pin as intended. Ticking 2024+2025+2026 is
    // the same scope as the "All years" chip: it still trips isWholeHolding
    // server-side, so the orphan-BudgetLine and org sales-forecast sweeps both
    // run. Only the year-less records tail is spared, and Task A never deletes
    // that tail anyway — so the two paths destroy the identical rows.
    expect(
      isHardStop({
        task: "clearYears",
        selectedCompanies: 27,
        totalCompanies: 27,
        allYears: false,
        selectedYears: [2024, 2025, 2026],
        availableYears: [2024, 2025, 2026],
      }),
    ).toBe(true)
  })

  it("does not fire when a year that holds data is left unticked", () => {
    expect(
      isHardStop({
        task: "clearYears",
        selectedCompanies: 27,
        totalCompanies: 27,
        allYears: false,
        selectedYears: [2025, 2026],
        availableYears: [2024, 2025, 2026],
      }),
    ).toBe(false)
  })

  it("does not fire before a year has been picked at all", () => {
    expect(
      isHardStop({
        task: "clearYears",
        selectedCompanies: 27,
        totalCompanies: 27,
        allYears: false,
        selectedYears: [],
        availableYears: [2025, 2026],
      }),
    ).toBe(false)
  })

  it("does not fire when the census found no years to compare against", () => {
    // An empty index means "we do not know what every year is". Guessing
    // would block a legitimate delete on a company that holds only
    // operational facts.
    expect(
      isHardStop({
        task: "clearYears",
        selectedCompanies: 27,
        totalCompanies: 27,
        allYears: false,
        selectedYears: [2026],
        availableYears: [],
      }),
    ).toBe(false)
  })

  it("does not fire on all years for a SUBSET of companies", () => {
    expect(
      isHardStop({
        task: "clearYears",
        selectedCompanies: 26,
        totalCompanies: 27,
        allYears: true,
      }),
    ).toBe(false)
  })

  it("never fires inside Task D — that IS the widest scope's door", () => {
    expect(
      isHardStop({
        task: "deleteAll",
        selectedCompanies: 27,
        totalCompanies: 27,
        allYears: true,
      }),
    ).toBe(false)
  })

  it("does not fire when there are no companies at all", () => {
    expect(
      isHardStop({ task: "clearYears", selectedCompanies: 0, totalCompanies: 0, allYears: true }),
    ).toBe(false)
  })
})

describe("canSubmit", () => {
  const gate = gateFor(base)
  const ok = {
    gate,
    typedToken: "AZSEKER-CPC",
    reason: "Replacing the draft file with signed accounts",
    previewRows: 1284,
    previewStale: false,
    armedAt: 0,
    now: 10_000,
    permanentAcks: {},
    permanentKeys: [] as string[],
    running: false,
    hardStop: false,
  }

  it("allows a complete, fresh, confirmed submission", () => {
    expect(canSubmit(ok)).toBe(true)
  })

  it("REFUSES an empty preview", () => {
    // The old check was `preview.rowsAffected >= 0` — true of every number a
    // count can return, so the red button was live on a preview of nothing.
    expect(canSubmit({ ...ok, previewRows: 0 })).toBe(false)
  })

  it("refuses a stale preview", () => {
    expect(canSubmit({ ...ok, previewStale: true })).toBe(false)
  })

  it("refuses a mistyped or lower-cased token", () => {
    expect(canSubmit({ ...ok, typedToken: "azseker-cpc" })).toBe(false)
    expect(canSubmit({ ...ok, typedToken: "ALL" })).toBe(false)
  })

  it("refuses a reason shorter than the tier requires", () => {
    expect(canSubmit({ ...ok, reason: "wrong" })).toBe(false)
  })

  it("refuses until every unrecoverable category is acknowledged", () => {
    const withPermanent = { ...ok, permanentKeys: ["budgetActualManual", "orphanBudgetLine"] }
    expect(canSubmit(withPermanent)).toBe(false)
    expect(
      canSubmit({ ...withPermanent, permanentAcks: { budgetActualManual: true } }),
    ).toBe(false)
    expect(
      canSubmit({
        ...withPermanent,
        permanentAcks: { budgetActualManual: true, orphanBudgetLine: true },
      }),
    ).toBe(true)
  })

  it("holds Task D disabled until the arm delay has elapsed", () => {
    const d = gateFor({ ...base, task: "deleteAll", companyCodes: MANY })
    const args = {
      ...ok,
      gate: d,
      typedToken: "ALL",
      reason: "Fresh start before the 2027 budget cycle",
      armedAt: 1_000,
    }
    expect(canSubmit({ ...args, now: 3_000 })).toBe(false)
    expect(canSubmit({ ...args, now: 6_500 })).toBe(true)
  })

  it("refuses while the hard stop is showing, whatever else is filled in", () => {
    expect(canSubmit({ ...ok, hardStop: true })).toBe(false)
  })
})
