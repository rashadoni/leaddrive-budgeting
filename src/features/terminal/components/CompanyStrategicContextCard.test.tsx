/**
 * Phase 7.M Tier 4 (2026-05-19) — tests for CompanyStrategicContextCard.
 * Uses happy-dom + manual fetch mock (mirror existing terminal-card test
 * style — no MSW dependency).
 */
// @vitest-environment happy-dom
import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor, cleanup } from "@testing-library/react"
import { CompanyStrategicContextCard } from "./CompanyStrategicContextCard"

const origFetch = global.fetch

afterEach(() => {
  cleanup()
  global.fetch = origFetch
})

function mockFetch(payload: unknown, ok = true) {
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(payload), { status: ok ? 200 : 500 }),
  ) as unknown as typeof fetch
}

describe("CompanyStrategicContextCard", () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it("renders nothing when company has no strategic content", async () => {
    mockFetch({
      companyCode: "AZSEKER-AZSF",
      companyName: "Sugar Factory",
      strategicDescription: null,
      competitiveAdvantage: null,
      landSummary: null,
      capexSummary: null,
      forwardForecast: null,
      hasAnyContent: false,
    })
    const { container } = render(
      <CompanyStrategicContextCard companyCode="AZSEKER-AZSF" />,
    )
    // Wait for loading to finish (await fetch resolution)
    await waitFor(() => {
      expect(container.querySelector('[class*="space-y-3"]')).toBeNull()
    })
  })

  it("renders strategic description + advantage", async () => {
    mockFetch({
      companyCode: "AZSEKER-EDEN",
      companyName: "Eden Agro",
      strategicDescription:
        "Əkinçilik ilə məşğul olan bir şirkətdir.",
      competitiveAdvantage: "Müasir suvarma sistemləri.",
      landSummary: null,
      capexSummary: null,
      forwardForecast: null,
      hasAnyContent: true,
    })
    render(<CompanyStrategicContextCard companyCode="AZSEKER-EDEN" />)
    await waitFor(() => {
      expect(screen.getByText(/Əkinçilik/)).toBeTruthy()
    })
    expect(screen.getByText(/Müasir suvarma/)).toBeTruthy()
  })

  it("renders land summary with hectares + regions", async () => {
    mockFetch({
      companyCode: "AZSEKER-EDEN",
      companyName: "Eden Agro",
      strategicDescription: null,
      competitiveAdvantage: null,
      landSummary: {
        parcelCount: 17,
        totalHectares: 22595.65,
        totalAnnualRentAzn: 293_103,
        regions: ["Ağcabədi", "Beyləqan", "Yevlax"],
        contractsExpiringWithinYears: 0,
      },
      capexSummary: null,
      forwardForecast: null,
      hasAnyContent: true,
    })
    render(<CompanyStrategicContextCard companyCode="AZSEKER-EDEN" />)
    await waitFor(() => {
      expect(screen.getByText(/22,596/)).toBeTruthy()
    })
    expect(screen.getByText(/17 parcels/)).toBeTruthy()
    expect(
      screen.getByText(/Ağcabədi, Beyləqan, Yevlax/),
    ).toBeTruthy()
  })

  it("renders CAPEX summary with top 3 initiatives", async () => {
    mockFetch({
      companyCode: "AZSEKER-CPC",
      companyName: "CPC",
      strategicDescription: null,
      competitiveAdvantage: null,
      landSummary: null,
      capexSummary: {
        totalItems: 7,
        totalAzn: 11_156_000,
        capexCount: 7,
        opexCount: 0,
        topByAmount: [
          {
            description: "Chemsan equipment",
            amountAzn: 6_324_000,
            type: "CAPEX" as const,
            category: "İstehsalat",
          },
          {
            description: "Water treatment plant",
            amountAzn: 750_000,
            type: "CAPEX" as const,
            category: "İstehsalat",
          },
        ],
      },
      forwardForecast: null,
      hasAnyContent: true,
    })
    render(<CompanyStrategicContextCard companyCode="AZSEKER-CPC" />)
    await waitFor(() => {
      expect(screen.getByText(/Chemsan equipment/)).toBeTruthy()
    })
    expect(screen.getByText(/Water treatment/)).toBeTruthy()
    expect(screen.getByText(/7 initiatives/)).toBeTruthy()
  })

  it("renders forward forecast years with top BU", async () => {
    mockFetch({
      companyCode: "AZSEKER-CPC",
      companyName: "CPC",
      strategicDescription: null,
      competitiveAdvantage: null,
      landSummary: null,
      capexSummary: null,
      forwardForecast: {
        source: "azseker-farming-strategy-2026-05-19",
        hasTerminalValue: true,
        years: [
          {
            year: 2026,
            totalRevenueAzn: 58_880_102,
            topBu: { businessUnit: "Buğda", revenueAzn: 15_836_740 },
          },
          {
            year: 2027,
            totalRevenueAzn: 94_804_155,
            topBu: { businessUnit: "Tekstil", revenueAzn: 35_000_000 },
          },
        ],
      },
      hasAnyContent: true,
    })
    render(<CompanyStrategicContextCard companyCode="AZSEKER-CPC" />)
    // Wait for the forecast section to appear — use exact "2026" to avoid matching
    // the source string "azseker-farming-strategy-2026-05-19" which also contains "2026"
    await waitFor(() => {
      expect(screen.getByText("2026")).toBeTruthy()
    })
    expect(screen.getByText(/Terminal value/)).toBeTruthy()
    // BU names are localized in the component; the test renders under the
    // mock locale "en" (vitest.setup useLocale → 'en'), so Buğda→Wheat / Tekstil→Cotton.
    expect(screen.getByText(/Wheat/)).toBeTruthy()
    expect(screen.getByText(/Cotton/)).toBeTruthy()
  })

  it("renders Risk Registry pending-verification badge when itemCount is 0", async () => {
    mockFetch({
      companyCode: "AZSEKER-AZSF",
      companyName: "Azərşəkər Sugar",
      strategicDescription: null,
      competitiveAdvantage: null,
      landSummary: null,
      capexSummary: null,
      forwardForecast: null,
      riskRegistry: {
        itemCount: 0,
        source: null,
        importedAt: null,
        pendingVerification: true,
      },
      hasAnyContent: true,
    })
    render(<CompanyStrategicContextCard companyCode="AZSEKER-AZSF" />)
    await waitFor(() => {
      expect(screen.getByTestId("risk-registry-pending")).toBeTruthy()
    })
    expect(screen.getByText(/Pending client verification/i)).toBeTruthy()
  })

  it("renders Risk Registry KRI count when populated (EDEN happy path)", async () => {
    mockFetch({
      companyCode: "AZSEKER-EDEN",
      companyName: "Eden Agro",
      strategicDescription: null,
      competitiveAdvantage: null,
      landSummary: null,
      capexSummary: null,
      forwardForecast: null,
      riskRegistry: {
        itemCount: 15,
        source: "Top risk - EDEN AGRO MMC.xlsx",
        importedAt: "2026-05-27T10:00:00Z",
        pendingVerification: false,
      },
      hasAnyContent: true,
    })
    render(<CompanyStrategicContextCard companyCode="AZSEKER-EDEN" />)
    await waitFor(() => {
      expect(screen.getByTestId("risk-registry-section")).toBeTruthy()
    })
    expect(screen.getByText("15")).toBeTruthy()
    expect(screen.queryByTestId("risk-registry-pending")).toBeNull()
  })

  it("does not render Risk Registry section for level-1 (riskRegistry: null)", async () => {
    mockFetch({
      companyCode: "AZSEKER",
      companyName: "AZSEKER Holding",
      strategicDescription: "Holding company root.",
      competitiveAdvantage: null,
      landSummary: null,
      capexSummary: null,
      forwardForecast: null,
      riskRegistry: null,
      hasAnyContent: true,
    })
    render(<CompanyStrategicContextCard companyCode="AZSEKER" />)
    await waitFor(() => {
      expect(screen.getByText(/Holding company root/)).toBeTruthy()
    })
    expect(screen.queryByTestId("risk-registry-section")).toBeNull()
  })

  it("shows error state on fetch failure", async () => {
    mockFetch({ error: "fail" }, false)
    render(<CompanyStrategicContextCard companyCode="AZSEKER-AZSF" />)
    await waitFor(() => {
      expect(screen.getByText(/Load error/)).toBeTruthy()
    })
  })

  it("does not fetch when companyCode is empty", () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
    render(<CompanyStrategicContextCard companyCode="" />)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
