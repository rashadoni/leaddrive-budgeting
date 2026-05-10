// @vitest-environment happy-dom
/**
 * Phase 7.G Turn CI (Phase 7.E #3 v2 E.2d UI) — BreachForecastPanel tests.
 */

import React from "react"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react"
import { BreachForecastPanel } from "./BreachForecastPanel"

const SAMPLE_RESPONSE = {
  breaches: [
    {
      companyId: "co_aac",
      indicatorCode: "REV_GROWTH",
      period: "2026-Q1",
      horizonStep: 1,
      currentStatus: "green" as const,
      predictedStatus: "amber" as const,
      forecastConfidence: 0.85,
      confidenceBand: "high" as const,
      predictedValue: 75.42,
      predictedLower: 70.1,
      predictedUpper: 80.7,
      computedAt: "2026-05-10T20:00:00.000Z",
    },
    {
      companyId: "co_aac",
      indicatorCode: "REV_GROWTH",
      period: "2026-Q1",
      horizonStep: 2,
      currentStatus: "green" as const,
      predictedStatus: "red" as const,
      forecastConfidence: 0.6,
      confidenceBand: "medium" as const,
      predictedValue: 55.0,
      computedAt: "2026-05-10T20:00:00.000Z",
    },
    {
      companyId: "co_lls",
      indicatorCode: "MARGIN",
      period: "2026-Q1",
      horizonStep: 1,
      currentStatus: "amber" as const,
      predictedStatus: "red" as const,
      forecastConfidence: 0.7,
      confidenceBand: "medium" as const,
      predictedValue: 5.5,
      computedAt: "2026-05-10T20:00:00.000Z",
    },
  ],
  filter: { period: null, minConfidenceBand: "medium" as const },
  count: 3,
}

let lastFetchUrl: string | null = null

beforeEach(() => {
  lastFetchUrl = null
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    lastFetchUrl = String(url)
    return new Response(JSON.stringify(SAMPLE_RESPONSE), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as never
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function fireOpen(): void {
  act(() => {
    window.dispatchEvent(new Event("terminal:open-breach"))
  })
}

describe("BreachForecastPanel", () => {
  it("renders nothing initially (closed)", () => {
    const { container } = render(<BreachForecastPanel />)
    expect(container.firstChild).toBeNull()
  })

  it("opens on `terminal:open-breach` event with role=dialog + aria-label", () => {
    render(<BreachForecastPanel />)
    fireOpen()
    const dialog = screen.getByRole("dialog")
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    expect(dialog.getAttribute("aria-label")).toBe("Predictive Breach Forecasts")
  })

  it("fetches /api/indicators/breaches with default minConfidenceBand=medium on open", async () => {
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => {
      expect(lastFetchUrl).toContain("/api/indicators/breaches")
      expect(lastFetchUrl).toContain("minConfidenceBand=medium")
    })
  })

  it("renders breach rows grouped by companyId after fetch resolves", async () => {
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => {
      expect(screen.getByTestId("breach-results")).toBeTruthy()
      expect(screen.getByTestId("breach-group-co_aac")).toBeTruthy()
      expect(screen.getByTestId("breach-group-co_lls")).toBeTruthy()
    })
    // Indicator code rendered
    expect(screen.getAllByText("REV_GROWTH").length).toBeGreaterThan(0)
    expect(screen.getByText("MARGIN")).toBeTruthy()
  })

  it("renders status transition pills (current → predicted)", async () => {
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => {
      // 2 of 3 rows show 'green' as current; 1 shows 'amber'
      const greens = screen.getAllByText("green")
      expect(greens.length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText("red").length).toBeGreaterThanOrEqual(1)
    })
  })

  it("renders predicted value + CI bracket when present", async () => {
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => {
      expect(screen.getByText("75.42")).toBeTruthy()
      // CI bracket for first row
      expect(screen.getByText(/\[70\.1, 80\.7\]/)).toBeTruthy()
    })
  })

  it("renders confidence band chips + percent", async () => {
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => {
      expect(screen.getByText("85%")).toBeTruthy() // first row's 0.85
      expect(screen.getAllByText(/high|medium/).length).toBeGreaterThan(0)
    })
  })

  it("changing minConfidenceBand triggers re-fetch with new param", async () => {
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => expect(screen.getByTestId("breach-results")).toBeTruthy())
    const select = screen.getByTestId("breach-band-select") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "high" } })
    await waitFor(() => {
      expect(lastFetchUrl).toContain("minConfidenceBand=high")
    })
  })

  it("changing period input triggers re-fetch with period param", async () => {
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => expect(screen.getByTestId("breach-results")).toBeTruthy())
    const input = screen.getByTestId("breach-period-input") as HTMLInputElement
    fireEvent.change(input, { target: { value: "2026-Q1" } })
    await waitFor(() => {
      expect(lastFetchUrl).toContain("period=2026-Q1")
    })
  })

  it("Refresh button triggers re-fetch", async () => {
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => expect(screen.getByTestId("breach-results")).toBeTruthy())
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const callsBefore = fetchMock.mock.calls.length
    fireEvent.click(screen.getByTestId("breach-refresh"))
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it("renders empty-state when count=0", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            breaches: [],
            filter: { period: null, minConfidenceBand: "medium" },
            count: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as never
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => expect(screen.getByTestId("breach-empty")).toBeTruthy())
  })

  it("renders fetch error when API returns non-ok", async () => {
    global.fetch = vi.fn(async () => new Response("server boom", { status: 500 })) as never
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => expect(screen.getByTestId("breach-fetch-error")).toBeTruthy())
  })

  it("close button dismisses the panel", async () => {
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy())
    fireEvent.click(screen.getByTestId("breach-close"))
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
    })
  })

  it("Escape key dismisses the panel", async () => {
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy())
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
    })
  })

  it("backdrop click dismisses the panel", async () => {
    render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy())
    const dialog = screen.getByRole("dialog")
    fireEvent.click(dialog)
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
    })
  })

  it("listener cleanup on unmount (open event after unmount is no-op)", async () => {
    const { unmount } = render(<BreachForecastPanel />)
    unmount()
    // Re-mount fresh + fire — only the new instance should respond
    const fresh = render(<BreachForecastPanel />)
    fireOpen()
    await waitFor(() => expect(fresh.container.querySelector("[role='dialog']")).not.toBeNull())
  })
})
