// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org-1", role: "viewer" } } }),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    const months: Record<string, string> = {
      monthJan: "January", monthFeb: "February", monthMar: "March",
      monthApr: "April", monthMay: "May", monthJun: "June",
      monthJul: "July", monthAug: "August", monthSep: "September",
      monthOct: "October", monthNov: "November", monthDec: "December",
    }
    if (months[key]) return months[key]
    if (key === "balanceSheetAsOf") return `As of ${vars?.month} ${vars?.year}`
    if (key === "balanceSheetLineItems") return `${vars?.count} accounts`
    return key
  },
}))

vi.mock("recharts", () => {
  const Element = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return {
    XAxis: Element, YAxis: Element, CartesianGrid: Element, Tooltip: Element,
    Legend: Element, ResponsiveContainer: Element, PieChart: Element, Pie: Element,
    Cell: Element, AreaChart: Element, Area: Element,
  }
})

import { BudgetBalanceSheet } from "./budget-balance-sheet"

function renderBalanceSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BudgetBalanceSheet planId="plan-1" />
    </QueryClientProvider>,
  )
}

const row = (id: string, lineType: string, month: number, amount: number) => ({
  id, lineType, month, amount, account: { code: id, name: id },
})

describe("Budget Balance Sheet evidence UI", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()))
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows an API failure instead of converting it to an empty plan", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "upstream failed" }),
    } as Response)

    renderBalanceSheet()

    expect(await screen.findByTestId("balance-sheet-error")).toBeTruthy()
    expect(screen.queryByTestId("balance-sheet-empty")).toBeNull()
  })

  it("preserves an explicit zero but renders absent future months as dashes", async () => {
    const assets = [row("cash", "asset", 5, 0)]
    const liabilities = [row("debt", "liability", 5, 0)]
    const equity = [row("capital", "equity", 5, 0)]
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        assets, liabilities, equity, all: [...assets, ...liabilities, ...equity],
        meta: { sourceYear: 2024, fellBack: true },
      }),
    } as Response)

    renderBalanceSheet()

    const assetsToggle = await screen.findByTestId("balance-sheet-section-assets")
    const cells = assetsToggle.closest("tr")!.querySelectorAll("td")
    expect(cells[5].textContent).toBe("0")
    expect(cells[6].textContent).toBe("—")
    expect(cells[12].textContent).toBe("—")
    expect(screen.getByTestId("balance-sheet-kpi-debt-equity").textContent).toContain("—")
    expect(document.body.textContent).toContain("As of May 2024")
  })

  it("fails D/E closed when equity evidence is missing", async () => {
    const assets = [row("cash", "asset", 5, 100)]
    const liabilities = [row("debt", "liability", 5, -40)]
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        assets, liabilities, equity: [], all: [...assets, ...liabilities],
        meta: { sourceYear: 2025, fellBack: false },
      }),
    } as Response)

    renderBalanceSheet()

    expect((await screen.findByTestId("balance-sheet-kpi-debt-equity")).textContent).toContain("—")
    expect(screen.getByTestId("balance-sheet-kpi-liabilities").textContent).toContain("—")
  })

  it("does not publish D/E as healthy when evidenced equity is negative", async () => {
    const assets = [row("cash", "asset", 5, 100)]
    const liabilities = [row("debt", "liability", 5, 200)]
    const equity = [row("capital", "equity", 5, -100)]
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ assets, liabilities, equity, all: [...assets, ...liabilities, ...equity] }),
    } as Response)

    renderBalanceSheet()

    expect((await screen.findByTestId("balance-sheet-kpi-equity")).textContent).toContain("(100)")
    expect(screen.getByTestId("balance-sheet-kpi-debt-equity").textContent).toContain("—")
  })

  it("toggles sections locally without another request", async () => {
    const assets = [row("cash", "asset", 5, 100)]
    const liabilities = [row("debt", "liability", 5, -40)]
    const equity = [row("capital", "equity", 5, -60)]
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ assets, liabilities, equity, all: [...assets, ...liabilities, ...equity] }),
    } as Response)

    renderBalanceSheet()
    const toggle = await screen.findByTestId("balance-sheet-section-assets")
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
