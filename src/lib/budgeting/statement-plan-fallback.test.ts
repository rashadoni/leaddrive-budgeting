import { describe, it, expect } from "vitest"
import { resolveBalanceSheetSourcePlan } from "./statement-plan-fallback"

describe("resolveBalanceSheetSourcePlan", () => {
  it("redirects a BUDGET plan to the matching-year actuals plan (the fix)", () => {
    const r = resolveBalanceSheetSourcePlan(
      { id: "budget-2026", kind: "budget" },
      { id: "actuals-2026", kind: "actual" },
    )
    expect(r).toEqual({ sourcePlanId: "actuals-2026", fellBack: true })
  })

  it("reads an ACTUAL plan from itself (no fallback)", () => {
    const r = resolveBalanceSheetSourcePlan(
      { id: "actuals-2025", kind: "actual" },
      { id: "actuals-2025", kind: "actual" },
    )
    expect(r).toEqual({ sourcePlanId: "actuals-2025", fellBack: false })
  })

  it("keeps the budget plan when NO matching-year actuals plan exists", () => {
    const r = resolveBalanceSheetSourcePlan(
      { id: "budget-2027", kind: "budget" },
      null,
    )
    expect(r).toEqual({ sourcePlanId: "budget-2027", fellBack: false })
  })

  it("does not fall back onto itself if the lookup returns the same id", () => {
    const r = resolveBalanceSheetSourcePlan(
      { id: "p1", kind: "budget" },
      { id: "p1", kind: "actual" },
    )
    expect(r).toEqual({ sourcePlanId: "p1", fellBack: false })
  })

  it("treats a null/legacy kind as non-budget (no fallback) — protects the mock-plan path", () => {
    const r = resolveBalanceSheetSourcePlan(
      { id: "p1", kind: null },
      { id: "actuals-2026", kind: "actual" },
    )
    expect(r).toEqual({ sourcePlanId: "p1", fellBack: false })
  })
})
