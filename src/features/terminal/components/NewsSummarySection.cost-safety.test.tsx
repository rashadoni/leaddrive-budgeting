// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => ({
    "todayBrief.newsHeader": "Holding news",
    "todayBrief.newsGenerate": "Generate summary",
    "todayBrief.newsGenerateHint": "Generate on demand.",
    "todayBrief.newsRefresh": "Refresh summary",
    "todayBrief.newsLoading": "AI preparing summary…",
    "todayBrief.newsEmpty": "No fresh news",
    "todayBrief.newsPopOut": "Open news",
  })[key] ?? key,
}))

import { NewsSummarySection } from "./NewsSummarySection"

describe("NewsSummarySection cost safety", () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => cleanup())

  it("does not call the paid endpoint on render", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    render(<NewsSummarySection />)

    expect(screen.getByRole("button", { name: "Generate summary" })).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("adds explicit intent only after the user clicks Generate", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ bullets: [], language: "en", generatedAt: "now", itemsConsumed: 0, fromCache: false }), { status: 200 }),
    )
    render(<NewsSummarySection />)
    fireEvent.click(screen.getByRole("button", { name: "Generate summary" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(String(fetchMock.mock.calls[0][0])).toContain("userInitiated=1")
  })
})
