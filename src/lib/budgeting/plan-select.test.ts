import { describe, it, expect } from "vitest"
import { pickDefaultPlanId } from "./plan-select"
import type { BudgetPlan } from "./types"

function plan(p: Partial<BudgetPlan> & { id: string; year: number; lines: number; kind?: "actual" | "budget" }): BudgetPlan {
  return {
    id: p.id,
    organizationId: "org",
    name: p.id,
    periodType: "annual",
    year: p.year,
    status: "draft",
    kind: p.kind,
    _count: { lines: p.lines },
  } as BudgetPlan
}

describe("pickDefaultPlanId", () => {
  it("prefers a POPULATED budget plan (so execution % shows on load)", () => {
    const plans = [
      plan({ id: "budget26", year: 2026, kind: "budget", lines: 2700 }),
      plan({ id: "actual26", year: 2026, kind: "actual", lines: 732 }),
      plan({ id: "empty25", year: 2025, kind: "actual", lines: 0 }),
    ]
    expect(pickDefaultPlanId(plans)).toBe("budget26")
  })

  it("picks the NEWEST populated budget plan when several exist", () => {
    const plans = [
      plan({ id: "budget25", year: 2025, kind: "budget", lines: 100 }),
      plan({ id: "budget26", year: 2026, kind: "budget", lines: 100 }),
    ]
    expect(pickDefaultPlanId(plans)).toBe("budget26")
  })

  it("falls back to the newest populated plan when no budget plan has data", () => {
    const plans = [
      plan({ id: "actual24", year: 2024, kind: "actual", lines: 50 }),
      plan({ id: "actual26", year: 2026, kind: "actual", lines: 700 }),
      plan({ id: "emptyBudget26", year: 2026, kind: "budget", lines: 0 }),
    ]
    expect(pickDefaultPlanId(plans)).toBe("actual26")
  })

  it("skips empty placeholder plans entirely", () => {
    const plans = [
      plan({ id: "empty21", year: 2021, kind: "actual", lines: 0 }),
      plan({ id: "empty22", year: 2022, kind: "actual", lines: 0 }),
      plan({ id: "actual23", year: 2023, kind: "actual", lines: 214 }),
    ]
    expect(pickDefaultPlanId(plans)).toBe("actual23")
  })

  it("falls back to the first plan when ALL are empty", () => {
    const plans = [
      plan({ id: "empty21", year: 2021, lines: 0 }),
      plan({ id: "empty22", year: 2022, lines: 0 }),
    ]
    expect(pickDefaultPlanId(plans)).toBe("empty21")
  })

  it("returns '' for no plans", () => {
    expect(pickDefaultPlanId([])).toBe("")
  })
})
