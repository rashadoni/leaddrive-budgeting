// @vitest-environment happy-dom
/**
 * Phase 7.I Track C smoke tests — CommodityTickerPanel.
 *
 * Locks the two render branches that drive the visible UI:
 *   1. Sugar card — latest value + 12M mean + variance % vs 12M mean
 *   2. Per-region weather strip — 90d rainfall + 30d temp for
 *      Salyan / Imishli / Sabirabad
 *
 * Mocks `/api/intel/data-points` so the test doesn't depend on real
 * commodity ingest. Verifies the panel correctly computes the variance
 * percentage from the trailing series and renders all 3 region cards.
 */
import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, waitFor, screen, cleanup } from "@testing-library/react"
import { CommodityTickerPanel } from "./CommodityTickerPanel"

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
}

beforeEach(() => {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/intel/data-points")) {
      const u = new URL(url, "http://localhost")
      const source = u.searchParams.get("sourceCode")
      if (source === "sugar-yahoo-sb-f") {
        // 12 flat observations at 300 + 1 latest at 330. last12 (the panel
        // slices `.slice(-12)`) covers indices 1..12, mean = (300*11 + 330) / 12
        // = 302.5. Variance = (330 - 302.5) / 302.5 ≈ +9.1%.
        const rows = Array.from({ length: 13 }, (_, i) => ({
          metric: "SUGAR_RAW_USD_TONNE",
          datetime: new Date(2025, i, 1).toISOString(),
          value: i === 12 ? 330 : 300,
          unit: "USD/tonne",
        }))
        return new Response(JSON.stringify({ rows }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (source === "weather-openmeteo") {
        // One latest observation per region × 2 metrics.
        const rows = [
          { metric: "SALYAN_RAINFALL_MM_90D", datetime: "2026-05-01T00:00:00Z", value: 134.4, unit: "mm" },
          { metric: "SALYAN_TEMP_AVG_C_30D", datetime: "2026-05-01T00:00:00Z", value: 15.0, unit: "°C" },
          { metric: "IMISHLI_RAINFALL_MM_90D", datetime: "2026-05-01T00:00:00Z", value: 131.3, unit: "mm" },
          { metric: "IMISHLI_TEMP_AVG_C_30D", datetime: "2026-05-01T00:00:00Z", value: 15.3, unit: "°C" },
          { metric: "SABIRABAD_RAINFALL_MM_90D", datetime: "2026-05-01T00:00:00Z", value: 147.7, unit: "mm" },
          { metric: "SABIRABAD_TEMP_AVG_C_30D", datetime: "2026-05-01T00:00:00Z", value: 15.2, unit: "°C" },
        ]
        return new Response(JSON.stringify({ rows }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      return new Response(JSON.stringify({ rows: [] }), { status: 200 })
    }
    return new Response("not found", { status: 404 })
  }) as never
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderPanel() {
  const client = makeClient()
  return render(
    <QueryClientProvider client={client}>
      <CommodityTickerPanel />
    </QueryClientProvider>,
  )
}

describe("CommodityTickerPanel", () => {
  it("renders the sugar card with latest, 12M mean, and variance %", async () => {
    renderPanel()
    await waitFor(() => {
      // fmtNum(_, 1) renders "330.0" (latest) and "302.5" (12M mean over
      // values.slice(-12)). The dollar sign sits in a sibling span, so
      // match the formatted number directly.
      expect(document.body.innerText).toContain("330.0")
    })
    expect(document.body.innerText).toContain("302.5")
    // Variance label — +9.1% (330 vs 302.5).
    expect(document.body.innerText).toMatch(/\+9\.1% vs 12M mean/)
  })

  it("renders weather cards for all 3 configured regions", async () => {
    renderPanel()
    // Wait for the weather rainfall to land (latest react-query state has
    // each region's data settled). Loading state shows "Loading" text.
    await waitFor(
      () => {
        // The mock returns 134.4mm / 131.3 / 147.7 for Salyan/Imishli/Sabirabad.
        // fmtNum rounds to 0 decimals → "134", "131", "148".
        expect(document.body.innerText).toContain("134")
        expect(document.body.innerText).toContain("131")
        expect(document.body.innerText).toContain("148")
      },
      { timeout: 3000 },
    )
    // Region labels rendered (capitalized: Salyan/Imishli/Sabirabad).
    expect(document.body.innerText).toMatch(/Salyan/)
    expect(document.body.innerText).toMatch(/Imishli/)
    expect(document.body.innerText).toMatch(/Sabirabad/)
  })
})
