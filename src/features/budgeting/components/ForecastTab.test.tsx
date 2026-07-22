// @vitest-environment happy-dom
import React from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { hooks } = vi.hoisted(() => ({
  hooks: {
    useBudgetAnalytics: vi.fn(),
    useBudgetForecastEntries: vi.fn(),
    useBudgetLines: vi.fn(),
    useExchangeRates: vi.fn(),
    useCreateBudgetLine: vi.fn(),
    useUpsertBudgetForecast: vi.fn(),
  },
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (key === "monthsShort") return "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec"
    if (key === "forecastBaselineNotice") return `baseline source=${vars?.sourceLines} categories=${vars?.categories} saved=${vars?.saved} ignored=${vars?.ignored}`
    if (key === "forecastCurrencyKnown") return `currency=${vars?.code}`
    if (key === "forecastShareOfRevenue") return `${vars?.value}% share`
    if (key === "forecastEbitdaMargin") return `${vars?.value}% margin`
    return key
  },
}))

vi.mock("@/lib/budgeting/hooks", () => hooks)

vi.mock("recharts", () => {
  const Element = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const Chart = ({ data }: { children?: React.ReactNode; data?: unknown }) => (
    <div data-testid="forecast-chart-data" data-chart={JSON.stringify(data)} />
  )
  return {
    Bar: Element,
    CartesianGrid: Element,
    ComposedChart: Chart,
    Legend: Element,
    Line: Element,
    ResponsiveContainer: Element,
    Tooltip: Element,
    XAxis: Element,
    YAxis: Element,
  }
})

vi.mock("@/components/animated-number", () => ({
  AnimatedNumber: ({ value, formatter }: { value: number; formatter?: (value: number) => string }) => (
    <span data-testid="animated-number">{formatter ? formatter(value) : value}</span>
  ),
}))

import { ForecastTab } from "./ForecastTab"

const query = <T,>(data: T, overrides: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  error: null,
  ...overrides,
})

const line = (id: string, category: string, lineType: "revenue" | "cogs" | "expense", plannedAmount: number) => ({
  id,
  category,
  lineType,
  plannedAmount,
  parentId: null,
  children: [],
  notes: null,
})

describe("ForecastTab evidence and formula semantics", () => {
  beforeEach(() => {
    hooks.useBudgetAnalytics.mockReset().mockReturnValue(query({
      plan: { id: "plan-1", year: 2026, periodType: "annual", quarter: null, month: null },
    }))
    hooks.useBudgetForecastEntries.mockReset().mockReturnValue(query([]))
    hooks.useBudgetLines.mockReset().mockReturnValue(query([
      line("r", "Revenue A", "revenue", 120),
      line("c", "COGS A", "cogs", 48),
      line("e", "Expense A", "expense", 30),
    ]))
    hooks.useExchangeRates.mockReset().mockReturnValue(query({ currencies: [] }))
    hooks.useCreateBudgetLine.mockReset().mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    hooks.useUpsertBudgetForecast.mockReset().mockReturnValue({ mutateAsync: vi.fn() })
  })

  afterEach(cleanup)

  it("shows an API failure instead of converting it to an empty forecast", () => {
    hooks.useBudgetForecastEntries.mockReturnValue(query([], { error: new Error("upstream") }))
    render(<ForecastTab planId="plan-1" />)
    expect(screen.getByTestId("forecast-error")).toBeTruthy()
    expect(screen.queryByTestId("forecast-empty")).toBeNull()
    expect(screen.queryByTestId("forecast-kpis")).toBeNull()
  })

  it("fails closed when analytics returns no selected plan context", () => {
    hooks.useBudgetAnalytics.mockReturnValue(query(undefined))
    render(<ForecastTab planId="plan-1" />)
    expect(screen.getByTestId("forecast-error").textContent).toContain("forecastPlanUnavailable")
    expect(screen.queryByTestId("forecast-kpis")).toBeNull()
  })

  it("shows a true empty state rather than zero KPIs when plan lines are absent", () => {
    hooks.useBudgetLines.mockReturnValue(query([]))
    render(<ForecastTab planId="plan-1" />)
    expect(screen.getByTestId("forecast-empty")).toBeTruthy()
    expect(screen.queryByTestId("forecast-kpis")).toBeNull()
  })

  it("discloses plan fallback, saved override count, and unknown currency", () => {
    hooks.useBudgetForecastEntries.mockReturnValue(query([
      { category: "Revenue A", lineType: "revenue", year: 2026, month: 1, forecastAmount: 0 },
    ]))
    render(<ForecastTab planId="plan-1" />)
    expect(screen.getByTestId("forecast-provenance").textContent).toContain("saved=1")
    expect(screen.getByTestId("forecast-currency-unknown")).toBeTruthy()
    expect(screen.getByTestId("forecast-kpi-revenue").textContent).not.toContain("AZN")
    expect(screen.getByTestId("forecast-kpi-revenue").textContent).not.toContain("₼")
    expect(screen.getByTestId("forecast-guide-root").textContent).not.toContain("₼")
  })

  it("shows the configured base currency as explicit evidence", () => {
    hooks.useExchangeRates.mockReturnValue(query({ currencies: [{ code: "USD", isBase: true }] }))
    render(<ForecastTab planId="plan-1" />)
    expect(screen.getByTestId("forecast-currency-known").textContent).toContain("USD")
    expect(screen.getByTestId("forecast-kpi-revenue").textContent).toContain("USD")
    expect(screen.getByTestId("forecast-matrix").textContent).toContain("USD")
  })

  it("does not claim currency is unconfigured when currency evidence failed", () => {
    hooks.useExchangeRates.mockReturnValue(query({ currencies: [] }, { error: new Error("currency source") }))
    render(<ForecastTab planId="plan-1" />)
    expect(screen.getByTestId("forecast-currency-unknown").textContent).toBe("forecastCurrencyUnavailable")
  })

  it("keeps monthly and annual EBITDA consistent with COGS included", () => {
    render(<ForecastTab planId="plan-1" />)
    const summary = screen.getByTestId("forecast-pnl-ebitda")
    const matrix = screen.getByTestId("forecast-matrix-ebitda")
    const grossProfit = screen.getByTestId("forecast-matrix-gross-profit")

    expect(summary.textContent).toContain("3.5")
    expect(summary.textContent).toContain("42")
    expect(matrix.textContent).toContain("4")
    expect(matrix.textContent).toContain("42")
    expect(grossProfit.textContent).toContain("6")
    expect(grossProfit.textContent).toContain("72")
    const trend = JSON.parse(screen.getByTestId("forecast-chart-data").getAttribute("data-chart") ?? "[]")
    expect(trend[0]).toMatchObject({ revenue: 10, expenses: 6.5, profit: 3.5 })
    expect(screen.getByTestId("forecast-comparison-base").textContent).toContain("+42")
  })

  it("does not collide same-named categories across different line types", () => {
    hooks.useBudgetLines.mockReturnValue(query([
      line("r", "Shared", "revenue", 120),
      line("c", "Shared", "cogs", 48),
      line("e", "Shared", "expense", 30),
    ]))
    render(<ForecastTab planId="plan-1" />)
    expect(screen.getByTestId("forecast-matrix-ebitda").textContent).toContain("4")
    expect(screen.getByTestId("forecast-matrix-ebitda").textContent).toContain("42")
  })

  it("aggregates duplicate same-type categories instead of multiplying the last row", () => {
    hooks.useBudgetLines.mockReturnValue(query([
      line("r1", "Shared", "revenue", 120),
      line("r2", "Shared", "revenue", 80),
      line("c1", "Shared", "cogs", 48),
      line("c2", "Shared", "cogs", 12),
      line("e1", "Shared", "expense", 30),
      line("e2", "Shared", "expense", 10),
    ]))
    render(<ForecastTab planId="plan-1" />)
    expect(screen.getByTestId("forecast-provenance").textContent).toContain("source=6 categories=3")
    expect(screen.getByTestId("forecast-kpi-revenue").textContent).toContain("200")
    const grossValues = within(screen.getByTestId("forecast-matrix-gross-profit")).getAllByTestId("animated-number")
    const ebitdaValues = within(screen.getByTestId("forecast-matrix-ebitda")).getAllByTestId("animated-number")
    expect(Number(grossValues[grossValues.length - 1]?.textContent)).toBeCloseTo(140)
    expect(Number(ebitdaValues[ebitdaValues.length - 1]?.textContent)).toBeCloseTo(100)
  })

  it("applies only matching year, period, and category overrides while preserving explicit zero style", () => {
    hooks.useBudgetAnalytics.mockReturnValue(query({
      plan: { id: "plan-1", year: 2026, periodType: "quarterly", quarter: 1, month: null },
    }))
    hooks.useBudgetLines.mockReturnValue(query([line("r", "Revenue A", "revenue", 120)]))
    hooks.useBudgetForecastEntries.mockReturnValue(query([
      { id: "valid", year: 2026, month: 1, category: "Revenue A", lineType: "revenue", forecastAmount: 0 },
      { id: "year", year: 2025, month: 2, category: "Revenue A", lineType: "revenue", forecastAmount: 999 },
      { id: "period", year: 2026, month: 4, category: "Revenue A", lineType: "revenue", forecastAmount: 999 },
      { id: "category", year: 2026, month: 2, category: "Unknown", lineType: "revenue", forecastAmount: 999 },
    ]))
    render(<ForecastTab planId="plan-1" />)
    expect(screen.getByTestId("forecast-provenance").textContent).toContain("saved=1")
    expect(screen.getByTestId("forecast-provenance").textContent).toContain("ignored")
    fireEvent.click(screen.getByTestId("forecast-section-revenue"))
    const amountButtons = within(screen.getByTestId("forecast-matrix"))
      .getAllByRole("button")
      .filter((button) => /^0$|^40$/.test(button.textContent ?? ""))
    const savedZero = amountButtons.find((button) => button.textContent === "0")
    const fallback = amountButtons.find((button) => button.textContent === "40")
    expect(savedZero?.className).not.toContain("italic")
    expect(fallback?.className).toContain("italic")
  })

  it("does not turn unsupported-only source rows into a zero report", () => {
    hooks.useBudgetLines.mockReturnValue(query([
      { ...line("x", "Other", "expense", 100), lineType: "other" },
    ]))
    render(<ForecastTab planId="plan-1" />)
    expect(screen.getByTestId("forecast-empty")).toBeTruthy()
    expect(screen.queryByTestId("forecast-kpis")).toBeNull()
  })

  it("scenario and section controls remain local and do not invoke mutations", () => {
    render(<ForecastTab planId="plan-1" />)
    fireEvent.click(screen.getByTestId("forecast-scenario-optimistic"))
    fireEvent.click(screen.getByTestId("forecast-scenario-pessimistic"))
    fireEvent.click(screen.getByTestId("forecast-scenario-base"))
    fireEvent.click(screen.getByTestId("forecast-section-revenue"))
    fireEvent.click(screen.getByTestId("forecast-section-revenue"))

    expect(hooks.useUpsertBudgetForecast().mutateAsync).not.toHaveBeenCalled()
    expect(hooks.useCreateBudgetLine().mutateAsync).not.toHaveBeenCalled()
  })

  it("disables monthly editing outside Base to avoid double-applying multipliers", () => {
    render(<ForecastTab planId="plan-1" />)
    fireEvent.click(screen.getByTestId("forecast-scenario-optimistic"))
    fireEvent.click(screen.getByTestId("forecast-section-revenue"))
    const numeric = within(screen.getByTestId("forecast-matrix"))
      .getAllByRole("button", { hidden: true })
      .find((button) => button.textContent?.includes("11")) as HTMLButtonElement | undefined
    expect(numeric?.disabled).toBe(true)
    if (numeric) fireEvent.click(numeric)
    expect(hooks.useUpsertBudgetForecast().mutateAsync).not.toHaveBeenCalled()
  })
})
