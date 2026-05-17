// @vitest-environment happy-dom
/**
 * Phase 7.G Turn LXIV — ComparisonTab unit tests (audit Tier 2 H4b closure).
 *
 * Locks the multi-plan side-by-side UI logic extracted Turn LXI:
 *   - Loading state
 *   - Empty-not-enough-data (< 2 plans available)
 *   - Plan-picker toggle (select/deselect/max-4 cap)
 *   - KPI strip + comparison artefact rendering after >= 2 selected
 *
 * Note: ComparisonTab has no `data-testid` hooks today (older
 * pre-extraction component). Tests use button counting + role queries
 * + class signals instead. Adding testids is a defensive follow-up
 * worth filing if regression appears.
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

// Recharts spawns ResizeObserver under the hood; happy-dom doesn't have
// it natively. Stub minimally so the chart components render without
// throwing (test depth doesn't include chart-pixel verification).
beforeEach(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver
  }
})

import { ComparisonTab } from "./ComparisonTab"

afterEach(() => {
  cleanup()
})

const PLAN = (id: string, year: number, name: string) => ({
  id,
  name,
  year,
  periodType: "annual" as const,
  status: "approved",
  quarter: null,
  month: null,
  organizationId: "org_demo",
})

const ANALYTICS = (planned: number, actual: number) => ({
  data: {
    plan: { id: "p1", name: "FY", year: 2025 },
    totalPlanned: planned,
    totalActual: actual,
    totalVariance: actual - planned,
    byCategory: [
      { category: "Sales", planned: planned * 0.5, actual: actual * 0.5, variance: (actual - planned) * 0.5, variancePct: 10 },
      { category: "Rent", planned: planned * 0.3, actual: actual * 0.3, variance: (actual - planned) * 0.3, variancePct: 5 },
    ],
  },
})

describe("ComparisonTab — empty / loading", () => {
  beforeEach(() => {
    hooksMock.useBudgetPlans.mockReset()
    hooksMock.useBudgetAnalytics.mockReset()
    hooksMock.useBudgetAnalytics.mockReturnValue({ data: undefined, isLoading: false })
  })

  it("renders DataBoundary skeleton while plans loading (Turn CXVI migration)", () => {
    hooksMock.useBudgetPlans.mockReturnValue({ data: [], isLoading: true })
    const { getByTestId } = render(<ComparisonTab />)
    expect(getByTestId("data-boundary-skeleton")).toBeTruthy()
  })

  it("renders empty-not-enough-data when < 2 plans", () => {
    hooksMock.useBudgetPlans.mockReturnValue({
      data: [PLAN("p1", 2025, "FY2025")],
      isLoading: false,
    })
    render(<ComparisonTab />)
    // Empty state has BarChart2 icon (h-12 w-12)
    const icons = document.querySelectorAll("svg.h-12.w-12")
    expect(icons.length).toBeGreaterThan(0)
    // No plan picker grid (zero plan-buttons rendered)
    const planButtons = document.querySelectorAll('button[type="button"]')
    expect(planButtons.length).toBe(0)
  })

  it("renders plan picker grid when >= 2 plans available", () => {
    hooksMock.useBudgetPlans.mockReturnValue({
      data: [
        PLAN("p1", 2025, "FY2025"),
        PLAN("p2", 2024, "FY2024"),
      ],
      isLoading: false,
    })
    render(<ComparisonTab />)
    const planButtons = document.querySelectorAll("button.relative.rounded-xl")
    expect(planButtons.length).toBe(2)
  })
})

describe("ComparisonTab — plan-picker toggle", () => {
  beforeEach(() => {
    hooksMock.useBudgetPlans.mockReset().mockReturnValue({
      data: [
        PLAN("p1", 2025, "FY2025"),
        PLAN("p2", 2024, "FY2024"),
        PLAN("p3", 2023, "FY2023"),
      ],
      isLoading: false,
    })
    hooksMock.useBudgetAnalytics.mockReset().mockReturnValue({
      data: undefined,
      isLoading: false,
    })
  })

  it("toggling a plan triggers analytics fetch with that planId", () => {
    render(<ComparisonTab />)
    const planButtons = document.querySelectorAll(
      "button.relative.rounded-xl",
    ) as NodeListOf<HTMLButtonElement>
    fireEvent.click(planButtons[0])
    // useBudgetAnalytics called 4× per render (4 hook slots); after click
    // the 1st slot should hold the selected planId.
    const calls = hooksMock.useBudgetAnalytics.mock.calls
    // The most-recent batch of 4 calls reflects the latest selectedIds.
    const last4 = calls.slice(-4)
    expect(last4[0][0]).toBe("p1")
    // Slots 2-4 stay empty (only 1 plan selected)
    expect(last4[1][0]).toBe("")
    expect(last4[2][0]).toBe("")
    expect(last4[3][0]).toBe("")
  })

  it("clicking selected plan deselects it", () => {
    render(<ComparisonTab />)
    const planButtons = document.querySelectorAll(
      "button.relative.rounded-xl",
    ) as NodeListOf<HTMLButtonElement>
    fireEvent.click(planButtons[0]) // select p1
    fireEvent.click(planButtons[0]) // deselect p1
    const last4 = hooksMock.useBudgetAnalytics.mock.calls.slice(-4)
    // All slots empty after deselect
    expect(last4[0][0]).toBe("")
    expect(last4[1][0]).toBe("")
    expect(last4[2][0]).toBe("")
    expect(last4[3][0]).toBe("")
  })
})

describe("ComparisonTab — KPI cards rendered when 2+ selected", () => {
  it("renders comparison artefacts after selecting 2 plans with analytics data", () => {
    hooksMock.useBudgetPlans.mockReset().mockReturnValue({
      data: [
        PLAN("p1", 2025, "FY2025"),
        PLAN("p2", 2024, "FY2024"),
      ],
      isLoading: false,
    })
    // Each `useBudgetAnalytics(planId)` call returns the same fixture.
    // Slots 0+1 get data; slots 2+3 get empty.
    hooksMock.useBudgetAnalytics
      .mockReset()
      .mockImplementation((planId: string) => {
        if (planId === "") return { data: undefined, isLoading: false }
        return ANALYTICS(1_000_000, 1_120_000)
      })

    render(<ComparisonTab />)
    const planButtons = document.querySelectorAll(
      "button.relative.rounded-xl",
    ) as NodeListOf<HTMLButtonElement>
    fireEvent.click(planButtons[0])
    fireEvent.click(planButtons[1])

    // After 2 selected + analytics resolved, KPI comparison cards render
    // (one per selected plan). Each card has a planned-value cell with
    // .tabular-nums + a planned-relative-share progress bar. Verify the
    // KPI grid is present (≥ 2 cards = ≥ 2 .tabular-nums entries) and
    // that the manat suffix is rendered (formatted via fmtK + " ₼").
    const moneyCells = document.querySelectorAll(".tabular-nums")
    expect(moneyCells.length).toBeGreaterThanOrEqual(2)
    // Manat suffix presence — ensures the formatted-money helper actually ran.
    expect(document.body.textContent).toContain("₼")
  })
})

describe("ComparisonTab — sparkline trend column (Phase 3.1 v1.2 ext)", () => {
  // Locks the ship in e46d0a1 — the first-selected-plan's monthly
  // distribution renders as a sparkline in the new Trend column.
  it("renders MonthlySparkline polyline when first plan has monthlyPlanned + monthlyActual", () => {
    hooksMock.useBudgetPlans.mockReset().mockReturnValue({
      data: [PLAN("p1", 2025, "FY2025"), PLAN("p2", 2024, "FY2024")],
      isLoading: false,
    })
    const q1Heavy = [40_000, 50_000, 60_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 30_000, 80_000]
    const elapsed3 = [38_000, 52_000, 58_000, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    hooksMock.useBudgetAnalytics
      .mockReset()
      .mockImplementation((planId: string) => {
        if (planId === "") return { data: undefined, isLoading: false }
        // Both plans share fixture, but only the FIRST plan's row data
        // gets attached to row.monthlyPlanned / row.monthlyActual per the
        // ComparisonTab table-row builder.
        return {
          data: {
            totalPlanned: 400_000,
            totalActual: 148_000,
            totalVariance: -252_000,
            byCategory: [
              {
                category: "Sales",
                planned: 400_000,
                actual: 148_000,
                variance: -252_000,
                variancePct: -63,
                monthlyPlanned: q1Heavy,
                monthlyActual: elapsed3,
              },
            ],
          },
        }
      })

    render(<ComparisonTab />)
    const planButtons = document.querySelectorAll(
      "button.relative.rounded-xl",
    ) as NodeListOf<HTMLButtonElement>
    fireEvent.click(planButtons[0]) // select p1 (first)
    fireEvent.click(planButtons[1]) // select p2

    // The variance table emits one `variance-sparkline` SVG per row +
    // a plan polyline. With actuals present, the actual-overlay polyline
    // also renders.
    const sparkline = document.querySelector('[data-testid="variance-sparkline"]')
    expect(sparkline).toBeTruthy()
    const planLine = document.querySelector('[data-testid="variance-sparkline-plan"]')
    const actualLine = document.querySelector('[data-testid="variance-sparkline-actual"]')
    expect(planLine).toBeTruthy()
    expect(actualLine).toBeTruthy()
    // Tooltip mentions plan + actual labels
    const title = sparkline!.querySelector("title")
    expect(title?.textContent ?? "").toContain("plan")
    expect(title?.textContent ?? "").toContain("actual")
  })
})
