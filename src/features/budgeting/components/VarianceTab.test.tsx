// @vitest-environment happy-dom
/**
 * Phase 7.G Turn LXIV — VarianceTab unit tests (audit Tier 2 H4a closure).
 *
 * Locks the recently-extracted (Turn LX) UI logic that's been shipping
 * to RU/AZ users without component-level coverage. RelatedFunctionsMenu
 * test covers the link presence + tab switch wiring; this file covers
 * the rendered behaviour: plan picker selection, KPI computation,
 * sortable table, materiality filter, color-band classification.
 */

import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

const { hooksMock } = vi.hoisted(() => ({
  hooksMock: {
    useBudgetPlans: vi.fn(),
    useBudgetAnalytics: vi.fn(),
  },
}))

vi.mock("@/lib/budgeting/hooks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/budgeting/hooks")>(
    "@/lib/budgeting/hooks",
  )
  return { ...actual, ...hooksMock }
})

import { VarianceTab } from "./VarianceTab"

afterEach(() => {
  cleanup()
})

const PLAN_FIXTURE = {
  id: "p1",
  name: "FY2025 Annual",
  year: 2025,
  periodType: "annual" as const,
  status: "approved",
  quarter: null,
  month: null,
  organizationId: "org_demo",
}

beforeEach(() => {
  hooksMock.useBudgetPlans.mockReset()
  hooksMock.useBudgetAnalytics.mockReset()
  // Default: no plan selected → analytics returns nothing
  hooksMock.useBudgetAnalytics.mockReturnValue({
    data: undefined,
    isLoading: false,
  })
})

describe("VarianceTab — empty / loading states", () => {
  it("renders DataBoundary skeleton while plans loading (Turn CXVI migration)", () => {
    hooksMock.useBudgetPlans.mockReturnValue({ data: [], isLoading: true })
    const { getByTestId } = render(<VarianceTab />)
    expect(getByTestId("data-boundary-skeleton")).toBeTruthy()
  })

  it("renders empty-no-plans state when zero plans", () => {
    hooksMock.useBudgetPlans.mockReturnValue({ data: [], isLoading: false })
    render(<VarianceTab />)
    // EXPLICIT_LABELS fallback: 'varianceEmptyNoPlans' shows up since key not in map
    // Either the key surface OR a recognizable empty marker
    expect(screen.queryByTestId("variance-tab")).toBeNull()
  })

  it("renders pick-plan hint when plans loaded but none selected", () => {
    hooksMock.useBudgetPlans.mockReturnValue({
      data: [PLAN_FIXTURE],
      isLoading: false,
    })
    render(<VarianceTab />)
    expect(screen.getByTestId("variance-tab")).toBeTruthy()
    expect(screen.getByTestId("variance-pick-plan-hint")).toBeTruthy()
    // KPI strip not rendered (no plan selected)
    expect(screen.queryByTestId("variance-kpi-strip")).toBeNull()
  })
})

describe("VarianceTab — plan picker", () => {
  it("renders one button per plan with stable testid", () => {
    hooksMock.useBudgetPlans.mockReturnValue({
      data: [
        PLAN_FIXTURE,
        { ...PLAN_FIXTURE, id: "p2", name: "FY2024 Annual", year: 2024 },
      ],
      isLoading: false,
    })
    render(<VarianceTab />)
    expect(screen.getByTestId("variance-plan-p1")).toBeTruthy()
    expect(screen.getByTestId("variance-plan-p2")).toBeTruthy()
  })

  it("clicking a plan triggers analytics fetch with that planId", () => {
    hooksMock.useBudgetPlans.mockReturnValue({
      data: [PLAN_FIXTURE],
      isLoading: false,
    })
    render(<VarianceTab />)
    fireEvent.click(screen.getByTestId("variance-plan-p1"))
    // useBudgetAnalytics called multiple times (re-render); the LAST call
    // should be with the selected planId.
    const calls = hooksMock.useBudgetAnalytics.mock.calls
    const lastCall = calls[calls.length - 1]
    expect(lastCall[0]).toBe("p1")
  })
})

describe("VarianceTab — KPI strip + over-budget count", () => {
  it("renders KPI strip with planned/actual/variance/execution/over-budget cells", () => {
    hooksMock.useBudgetPlans.mockReturnValue({
      data: [PLAN_FIXTURE],
      isLoading: false,
    })
    hooksMock.useBudgetAnalytics.mockReturnValue({
      data: {
        totalPlanned: 1_000_000,
        totalActual: 1_120_000,
        totalVariance: 120_000, // +12% (over)
        executionPct: 112,
        byCategory: [
          { category: "Sales", planned: 500_000, actual: 600_000, variance: 100_000, variancePct: 20 },
          { category: "Rent", planned: 100_000, actual: 105_000, variance: 5_000, variancePct: 5 },
          { category: "IT", planned: 50_000, actual: 51_000, variance: 1_000, variancePct: 2 },
        ],
      },
      isLoading: false,
    })
    render(<VarianceTab />)
    // Force a plan selection so the KPI strip renders
    fireEvent.click(screen.getByTestId("variance-plan-p1"))
    expect(screen.getByTestId("variance-kpi-strip")).toBeTruthy()
    // Over-budget count surfaces 1 (only Sales >= 10%)
    const overBudget = screen.getByTestId("variance-over-budget-count")
    expect(overBudget.textContent).toContain("1")
  })
})

describe("VarianceTab — sortable table + materiality filter", () => {
  function makeFixture() {
    return {
      data: {
        totalPlanned: 1_000_000,
        totalActual: 1_120_000,
        totalVariance: 120_000,
        executionPct: 112,
        byCategory: [
          { category: "Aaa-low", planned: 500, actual: 510, variance: 10, variancePct: 2 },
          { category: "Bbb-amber", planned: 1000, actual: 1080, variance: 80, variancePct: 8 },
          { category: "Ccc-red", planned: 1000, actual: 1200, variance: 200, variancePct: 20 },
        ],
      },
      isLoading: false,
    }
  }

  function setup() {
    hooksMock.useBudgetPlans.mockReturnValue({
      data: [PLAN_FIXTURE],
      isLoading: false,
    })
    hooksMock.useBudgetAnalytics.mockReturnValue(makeFixture())
    render(<VarianceTab />)
    fireEvent.click(screen.getByTestId("variance-plan-p1"))
  }

  it("renders all 3 rows by default (showAll=true)", () => {
    setup()
    expect(screen.getByTestId("variance-row-Aaa-low")).toBeTruthy()
    expect(screen.getByTestId("variance-row-Bbb-amber")).toBeTruthy()
    expect(screen.getByTestId("variance-row-Ccc-red")).toBeTruthy()
  })

  it("rows have correct data-band attributes by variance %", () => {
    setup()
    expect(
      screen.getByTestId("variance-row-Aaa-low").getAttribute("data-band"),
    ).toBe("green")
    expect(
      screen.getByTestId("variance-row-Bbb-amber").getAttribute("data-band"),
    ).toBe("amber")
    expect(
      screen.getByTestId("variance-row-Ccc-red").getAttribute("data-band"),
    ).toBe("red")
  })

  it("rows carry aria-label with category + severity (Turn LXII a11y)", () => {
    setup()
    const redRow = screen.getByTestId("variance-row-Ccc-red")
    const ariaLabel = redRow.getAttribute("aria-label")
    expect(ariaLabel).toContain("Ccc-red")
    // EXPLICIT_LABELS template: "{category}: {severity} variance"
    // Severity for red band = "high"
    expect(ariaLabel).toContain("high")
  })

  it("default sort is variance-pct-desc (red first, green last)", () => {
    setup()
    const rows = document.querySelectorAll('tr[data-band]')
    expect(rows[0].getAttribute("data-testid")).toBe("variance-row-Ccc-red")
    expect(rows[1].getAttribute("data-testid")).toBe("variance-row-Bbb-amber")
    expect(rows[2].getAttribute("data-testid")).toBe("variance-row-Aaa-low")
  })

  it("toggling showAll=false hides green row at materiality 5%", () => {
    setup()
    // showAll default true → uncheck it
    const showAllCheckbox = screen.getByTestId("variance-show-all") as HTMLInputElement
    expect(showAllCheckbox.checked).toBe(true)
    fireEvent.click(showAllCheckbox)
    // Green (variancePct=2) drops; amber (8) + red (20) remain
    expect(screen.queryByTestId("variance-row-Aaa-low")).toBeNull()
    expect(screen.getByTestId("variance-row-Bbb-amber")).toBeTruthy()
    expect(screen.getByTestId("variance-row-Ccc-red")).toBeTruthy()
  })

  it("changing sort to category-asc reorders alphabetically", () => {
    setup()
    const sortSelect = screen.getByTestId("variance-sort") as HTMLSelectElement
    fireEvent.change(sortSelect, { target: { value: "category-asc" } })
    const rows = document.querySelectorAll('tr[data-band]')
    expect(rows[0].getAttribute("data-testid")).toBe("variance-row-Aaa-low")
    expect(rows[1].getAttribute("data-testid")).toBe("variance-row-Bbb-amber")
    expect(rows[2].getAttribute("data-testid")).toBe("variance-row-Ccc-red")
  })

  it("variance-table testid present when at least one row passes filter", () => {
    setup()
    expect(screen.getByTestId("variance-table")).toBeTruthy()
  })
})

describe("VarianceTab — empty-at-threshold state", () => {
  it("renders empty placeholder when filter excludes all rows", () => {
    hooksMock.useBudgetPlans.mockReturnValue({
      data: [PLAN_FIXTURE],
      isLoading: false,
    })
    hooksMock.useBudgetAnalytics.mockReturnValue({
      data: {
        totalPlanned: 1000,
        totalActual: 1010,
        totalVariance: 10,
        executionPct: 101,
        byCategory: [
          { category: "Stable", planned: 1000, actual: 1010, variance: 10, variancePct: 1 },
        ],
      },
      isLoading: false,
    })
    render(<VarianceTab />)
    fireEvent.click(screen.getByTestId("variance-plan-p1"))
    // Toggle showAll off → 1% variance row drops below 5% materiality default
    const showAllCheckbox = screen.getByTestId("variance-show-all") as HTMLInputElement
    fireEvent.click(showAllCheckbox)
    expect(screen.getByTestId("variance-empty")).toBeTruthy()
    expect(screen.queryByTestId("variance-table")).toBeNull()
  })
})
