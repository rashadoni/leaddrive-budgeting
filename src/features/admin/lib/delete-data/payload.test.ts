// @vitest-environment node
import { describe, it, expect } from "vitest"
import { buildCommitRequest, buildPreviewRequest, categoriesFor } from "./payload"
import type { TaskState } from "./payload"

const state: TaskState = {
  task: "clearYears",
  companyCodes: ["AZSEKER-CPC"],
  years: [2026],
  bundle: "everything",
  exactCategories: null,
  includeManualActuals: false,
  reason: "Replacing the draft file with signed accounts",
  confirmToken: "AZSEKER-CPC",
  expectRows: 1284,
}

describe("categoriesFor", () => {
  it("always includes indicators, whatever the bundle", () => {
    for (const bundle of ["everything", "statements", "operational"] as const) {
      expect(categoriesFor({ task: "clearYears", bundle, exactCategories: null })).toContain(
        "indicatorValue",
      )
    }
  })

  it("adds indicators even to a hand-picked list that omits them", () => {
    expect(
      categoriesFor({
        task: "clearYears",
        bundle: "everything",
        exactCategories: ["balanceSheetLine"],
      }),
    ).toEqual(["balanceSheetLine", "indicatorValue"])
  })

  it("keeps the records tail out of every year-scoped bundle", () => {
    // Those records carry no year. Offering them under "clear a year" would
    // be offering something the server correctly refuses to do.
    for (const bundle of ["everything", "statements", "operational"] as const) {
      expect(
        categoriesFor({ task: "clearYears", bundle, exactCategories: null }),
      ).not.toContain("records")
    }
  })

  it("sends no category list at all for tasks B and D — they mean everything", () => {
    expect(categoriesFor({ task: "removeCompany", bundle: "everything", exactCategories: null })).toEqual([])
    expect(categoriesFor({ task: "deleteAll", bundle: "everything", exactCategories: null })).toEqual([])
  })
})

describe("buildPreviewRequest", () => {
  it("sends ONE company as companyCode, so the server's own token is that code", () => {
    expect(buildPreviewRequest(state)).toMatchObject({
      entityKind: "AllImportData",
      companyCode: "AZSEKER-CPC",
      year: 2026,
    })
    expect(buildPreviewRequest(state)).not.toHaveProperty("companyCodes")
  })

  it("sends several companies as companyCodes[]", () => {
    const body = buildPreviewRequest({ ...state, companyCodes: ["A", "B"] })
    expect(body.companyCodes).toEqual(["A", "B"])
    expect(body).not.toHaveProperty("companyCode")
  })

  it("sends several years as years[], and none at all for all-years", () => {
    expect(buildPreviewRequest({ ...state, years: [2025, 2026] })).toMatchObject({
      years: [2025, 2026],
    })
    const allYears = buildPreviewRequest({ ...state, years: [] })
    expect(allYears).not.toHaveProperty("year")
    expect(allYears).not.toHaveProperty("years")
  })

  it("maps each bundle to its own category list", () => {
    expect(buildPreviewRequest({ ...state, bundle: "statements" }).include).toEqual([
      "budgetLine",
      "balanceSheetLine",
      "cashFlowEntry",
      "counterparty",
      "indicatorValue",
    ])
    expect(buildPreviewRequest({ ...state, bundle: "operational" }).include).toEqual([
      "operationalFact",
      "budgetActual",
      "indicatorValue",
    ])
  })

  it("keeps hand-entered actuals unless the operator ticked the box", () => {
    expect(buildPreviewRequest(state)).not.toHaveProperty("includeManualActuals")
    expect(
      buildPreviewRequest({ ...state, includeManualActuals: true }).includeManualActuals,
    ).toBe(true)
  })

  it("Task B sends no year, no category list, and the unscoped tail", () => {
    const body = buildPreviewRequest({
      ...state,
      task: "removeCompany",
      years: [],
    })
    expect(body).not.toHaveProperty("year")
    expect(body).not.toHaveProperty("include")
    expect(body.includeUnscoped).toBe(true)
    expect(body.includeManualActuals).toBe(true)
  })

  it("Task D sends every company it was given, at every level", () => {
    const body = buildPreviewRequest({
      ...state,
      task: "deleteAll",
      companyCodes: ["GROUP", "A", "B"],
      years: [],
    })
    expect(body.companyCodes).toEqual(["GROUP", "A", "B"])
    expect(body.includeUnscoped).toBe(true)
  })
})

describe("buildCommitRequest", () => {
  it("carries the number the operator read, as the drift guard", () => {
    expect(buildCommitRequest(state)).toMatchObject({
      mode: "archive",
      confirmCode: "AZSEKER-CPC",
      expectRows: 1284,
      reason: "Replacing the draft file with signed accounts",
    })
  })

  it("has the same scope as the preview it was confirmed against", () => {
    const preview = buildPreviewRequest(state)
    const commit = buildCommitRequest(state)
    for (const key of Object.keys(preview) as Array<keyof typeof preview>) {
      expect(commit[key]).toEqual(preview[key])
    }
  })

  it("trims the reason so whitespace cannot pass a length gate server-side", () => {
    expect(buildCommitRequest({ ...state, reason: "  a real reason here  " }).reason).toBe(
      "a real reason here",
    )
  })
})
