// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  auditYearFor,
  companyTarget,
  expectedConfirmCode,
  producesRestorableEvent,
  MAX_COMPANY_CODES,
  parseCompanyCodes,
  parseDeleteSelection,
  parseYears,
  selectedYears,
  WIDEST_CONFIRM_TOKEN,
} from "./delete-request"

describe("parseCompanyCodes", () => {
  it("dedupes, drops blanks and non-strings", () => {
    expect(
      parseCompanyCodes({ companyCodes: ["A", "A", "", null, 7, "B"] as unknown[] }),
    ).toEqual(["A", "B"])
  })

  it("accepts a single companyCode", () => {
    expect(parseCompanyCodes({ companyCode: "A" })).toEqual(["A"])
    expect(parseCompanyCodes({})).toEqual([])
  })

  it("caps at 1000, not 200", () => {
    // 2026-07-31 — the old ceiling was 200. Past it, a "delete everything" was
    // silently truncated; the truncated list then failed the whole-holding
    // test, so the org-level sweeps never fired and the operator was told the
    // group was empty while it was not.
    const many = Array.from({ length: 1500 }, (_, i) => `C${i}`)
    expect(parseCompanyCodes({ companyCodes: many })).toHaveLength(MAX_COMPANY_CODES)
    expect(MAX_COMPANY_CODES).toBe(1000)
  })
})

describe("parseYears", () => {
  it("returns years[] sorted, and mirrors a single year into `year`", () => {
    expect(parseYears({ years: [2026, 2024] })).toEqual({ years: [2024, 2026] })
    expect(parseYears({ years: [2026] })).toEqual({ years: [2026], year: 2026 })
  })

  it("keeps the legacy single year when no list is sent", () => {
    expect(parseYears({ year: 2026 })).toEqual({ year: 2026 })
    expect(parseYears({})).toEqual({ year: undefined })
  })

  it("ignores non-integers", () => {
    expect(parseYears({ year: "2026" })).toEqual({ year: undefined })
    expect(parseYears({ years: [2026, 20.5, "x"] as unknown[] })).toEqual({
      years: [2026],
      year: 2026,
    })
  })
})

describe("parseDeleteSelection", () => {
  it("reproduces the old behaviour when only a year is sent", () => {
    expect(parseDeleteSelection({ year: 2026 })).toEqual({ year: 2026 })
  })

  it("drops unknown category names", () => {
    expect(
      parseDeleteSelection({ include: ["budgetLine", "wholeDatabase"] }),
    ).toMatchObject({ include: ["budgetLine"] })
  })

  it("only passes includeManualActuals when it is literally true", () => {
    // Defaulting this on is how the old reset destroyed hand-keyed actuals.
    expect(parseDeleteSelection({})).not.toHaveProperty("includeManualActuals")
    expect(parseDeleteSelection({ includeManualActuals: "yes" })).not.toHaveProperty(
      "includeManualActuals",
    )
    expect(parseDeleteSelection({ includeManualActuals: true })).toMatchObject({
      includeManualActuals: true,
    })
  })
})

describe("selectedYears", () => {
  it("returns every year the lock gate has to test", () => {
    expect(selectedYears({ years: [2025, 2026] })).toEqual([2025, 2026])
    expect(selectedYears({ year: 2026 })).toEqual([2026])
    // Empty means "all years" — the caller must treat that as covering every
    // locked period, not as "no year to check".
    expect(selectedYears({})).toEqual([])
  })
})

describe("companyTarget + expectedConfirmCode", () => {
  it("names one company in the body, and demands that name back", () => {
    const target = companyTarget(["AZSEKER-CPC"])
    expect(target).toEqual({ companyCode: "AZSEKER-CPC" })
    expect(expectedConfirmCode(target)).toBe("AZSEKER-CPC")
  })

  it("demands the widest token the moment the body carries a LIST", () => {
    // A mixed `{companyCode:"SAFE", companyCodes:["A","B"]}` must not pass on
    // "SAFE": the reset branch prefers the list, so the confirmation would
    // have named a company the delete never touched.
    expect(expectedConfirmCode({ companyCode: "SAFE", companyCodes: ["A", "B"] })).toBe("ALL")
    expect(companyTarget(["A", "B"])).toEqual({ companyCodes: ["A", "B"] })
    expect(expectedConfirmCode(companyTarget(["A", "B"]))).toBe("ALL")
  })

  it("treats a duplicated code as the one company it is", () => {
    expect(companyTarget(["A", "A"])).toEqual({ companyCode: "A" })
    expect(expectedConfirmCode(companyTarget(["A", "A"]))).toBe("A")
  })

  it("falls back to the widest token when nothing usable was given", () => {
    for (const body of [{}, { companyCodes: [] }, { companyCode: "" }, { companyCodes: [""] }]) {
      expect(expectedConfirmCode(body)).toBe(WIDEST_CONFIRM_TOKEN)
    }
  })

  it("never returns an empty string — there is always something to type", () => {
    for (const codes of [[], ["A"], ["A", "B"], ["", "B"]]) {
      expect(expectedConfirmCode(companyTarget(codes)).length).toBeGreaterThan(0)
    }
  })
})

/**
 * The one line that decides whether the operator, and not only technical
 * support, can undo a delete. `archive.ts` writes `metadata.year` through
 * `auditYearFor`; `RestoreTask` lists only events whose `year` is set; the
 * blast radius asks `producesRestorableEvent` what it is allowed to promise.
 */
describe("auditYearFor / producesRestorableEvent", () => {
  it("records a year — and offers a restore — only for exactly one named year", () => {
    expect(auditYearFor([2026])).toBe(2026)
    expect(producesRestorableEvent([2026])).toBe(true)
  })

  it("records NO year for a multi-year delete, so nothing can be offered", () => {
    expect(auditYearFor([2025, 2026])).toBeUndefined()
    expect(producesRestorableEvent([2025, 2026])).toBe(false)
  })

  it("records NO year for an all-years delete — Tasks B and D, always", () => {
    expect(auditYearFor([])).toBeUndefined()
    expect(producesRestorableEvent([])).toBe(false)
  })

  it("agrees with what parseYears puts on the wire", () => {
    // A body carrying `years: [2026]` normalises to a single year, so it IS
    // restorable even though the client sent an array.
    const parsed = parseYears({ years: [2026, 2026] })
    expect(producesRestorableEvent(selectedYears(parsed))).toBe(true)
    expect(producesRestorableEvent(selectedYears(parseYears({ years: [2025, 2026] })))).toBe(
      false,
    )
  })
})
