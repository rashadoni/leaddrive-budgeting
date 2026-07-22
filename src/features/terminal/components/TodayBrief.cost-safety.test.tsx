// @vitest-environment happy-dom
import React from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TodayBrief } from "./TodayBrief"

const setCompany = vi.fn()
const setActiveIv = vi.fn()
const setActivePanel = vi.fn()

vi.mock("../hooks/use-matrix", () => ({
  useMatrix: () => ({
    matrix: {
      period: "2025",
      companies: [{ id: "co1", code: "AZSEKER-AZSF", industry: "food_processing" }],
      indicators: [{
        id: "ind1",
        code: "FP_GROSS_MARGIN",
        nameEn: "Food Processing Gross Margin",
        nameRu: "Валовая маржа пищевого производства",
        nameAz: "Qida istehsalının ümumi marjası",
        unit: "%",
        direction: "higher_better",
      }],
      cells: [{
        companyId: "co1",
        indicatorId: "ind1",
        indicatorValueId: "iv1",
        value: -10,
        status: "red",
        sparkline: [],
      }],
    },
  }),
}))

vi.mock("../store/terminalStore", () => ({
  useTerminalStore: <T,>(selector: (state: unknown) => T) => selector({
    setActiveIndicatorValue: setActiveIv,
    setActivePanel,
    selectCompany: setCompany,
    alertMatches: null,
  }),
}))

vi.mock("./MorningBriefIntro", () => ({ MorningBriefIntro: () => null }))
vi.mock("./NewsSummarySection", () => ({ NewsSummarySection: () => null }))
vi.mock("./MoversSection", () => ({ MoversSection: () => null }))

beforeEach(() => {
  vi.useFakeTimers()
  setCompany.mockReset()
  setActiveIv.mockReset()
  setActivePanel.mockReset()
  global.fetch = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("TodayBrief paid-AI cost safety", () => {
  it("mount and row selection never auto-run the Variance Explainer", async () => {
    const dispatch = vi.spyOn(window, "dispatchEvent")
    render(<TodayBrief />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(dispatch.mock.calls.some(([event]) => event.type === "terminal:run-explainer")).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /Food Processing Gross Margin/i }))
    expect(setCompany).toHaveBeenCalledWith("AZSEKER-AZSF")
    expect(setActiveIv).toHaveBeenCalledWith("iv1")
    expect(setActivePanel).toHaveBeenCalledWith(3)
    expect(dispatch.mock.calls.some(([event]) => event.type === "terminal:run-explainer")).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
