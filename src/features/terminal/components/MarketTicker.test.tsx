// @vitest-environment happy-dom
/**
 * Phase 8 D2 (2026-05-28) — MarketTicker click-to-drill-down smoke.
 *
 * Locks the wiring: clicking a ticker entry pushes the user to the
 * Data Sources Catalog admin page.
 */
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import { MarketTicker } from "./MarketTicker"

const pushSpy = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy }),
}))

beforeEach(() => {
  pushSpy.mockReset()
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        entries: [
          {
            metric: "fx_usd_azn",
            label: "USD/AZN",
            current: 1.7,
            previous: 1.69,
            unit: "",
            source: "cbar-official-fx",
          },
          {
            metric: "sugar_price",
            label: "Sugar",
            current: 21.5,
            previous: 22.1,
            unit: "USD/cwt",
            source: "yahoo-sb-f",
          },
        ],
      }),
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("MarketTicker click-to-drill-down", () => {
  it("renders each entry as a button after data loads", async () => {
    render(<MarketTicker />)
    await waitFor(() => {
      expect(screen.getByTestId("market-ticker-entry-fx_usd_azn")).toBeTruthy()
    })
    expect(screen.getByTestId("market-ticker-entry-sugar_price")).toBeTruthy()
  })

  it("clicking an entry routes to /budgeting/admin/data-sources", async () => {
    render(<MarketTicker />)
    await waitFor(() => {
      expect(screen.getByTestId("market-ticker-entry-fx_usd_azn")).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId("market-ticker-entry-fx_usd_azn"))
    expect(pushSpy).toHaveBeenCalledWith("/budgeting/admin/data-sources")
  })

  it("includes tooltip + aria-label attributes for SR + hover affordance", async () => {
    render(<MarketTicker />)
    await waitFor(() => {
      expect(screen.getByTestId("market-ticker-entry-fx_usd_azn")).toBeTruthy()
    })
    const entry = screen.getByTestId("market-ticker-entry-fx_usd_azn")
    // Global next-intl test mock returns fallback labels («CLICK HINT»
    // / «ENTRY ARIA LABEL») without value interpolation — the test
    // verifies the keys are wired, not the live source-string render.
    expect(entry.getAttribute("title")).toBeTruthy()
    expect(entry.getAttribute("aria-label")).toBeTruthy()
  })
})
