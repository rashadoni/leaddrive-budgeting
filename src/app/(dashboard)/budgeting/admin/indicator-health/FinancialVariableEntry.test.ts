import { describe, it, expect } from "vitest"
import {
  buildFinancialVariableBody,
  summarizeRecompute,
  buildYearOptions,
} from "./FinancialVariableEntry"

describe("buildFinancialVariableBody", () => {
  it("builds the POST body and defaults the inline provenance note", () => {
    const body = buildFinancialVariableBody({
      companyId: "c1",
      variable: "inventory",
      year: 2025,
      value: 1_200_000,
      forceConfirm: false,
    })
    expect(body).toEqual({
      companyId: "c1",
      variable: "inventory",
      year: 2025,
      value: 1_200_000,
      sourceNote: "inline:indicator-health",
      forceConfirm: false,
    })
  })

  it("passes an explicit sourceNote + forceConfirm through unchanged", () => {
    const body = buildFinancialVariableBody({
      companyId: "c2",
      variable: "inventory",
      year: 2024,
      value: 50,
      forceConfirm: true,
      sourceNote: "from-audit",
    })
    expect(body.sourceNote).toBe("from-audit")
    expect(body.forceConfirm).toBe(true)
  })
})

describe("summarizeRecompute", () => {
  it("returns null for a null/undefined payload", () => {
    expect(summarizeRecompute(null)).toBeNull()
    expect(summarizeRecompute(undefined)).toBeNull()
  })

  it("sums ok+unknown+failed into total, keeps ok", () => {
    expect(summarizeRecompute({ ok: 3, unknown: 1, failed: 2 })).toEqual({
      ok: 3,
      total: 6,
    })
  })
})

describe("buildYearOptions", () => {
  it("returns the current year and the prior 3, newest first", () => {
    expect(buildYearOptions(2026)).toEqual([2026, 2025, 2024, 2023])
  })

  it("the default selection (index 1) is the latest completed year", () => {
    const opts = buildYearOptions(2026)
    expect(opts[1]).toBe(2025)
  })

  it("respects a custom span", () => {
    expect(buildYearOptions(2026, 2)).toEqual([2026, 2025])
  })
})
