// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => ({
    "morningBrief.header": "AI Morning Brief",
    "morningBrief.generate": "Generate brief",
    "morningBrief.generateHint": "Generate on demand from the current risk data.",
    "morningBrief.waitForData": "Risk data is still loading.",
    "morningBrief.loading": "AI composing today's brief…",
    "morningBrief.refresh": "Refresh brief",
    "morningBrief.calmMorning": "Calm morning",
  })[key] ?? key,
}))

import { MorningBriefIntro } from "./MorningBriefIntro"

const inputs = {
  worstCells: [
    { companyCode: "AAC", indicatorCode: "IND_DSO", value: 90, unit: "days" },
  ],
  topMovers: [],
  activeAlerts: [],
}

describe("MorningBriefIntro cost safety", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("does not call any endpoint on render", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    render(<MorningBriefIntro inputs={inputs} matrixReady />)

    expect(
      screen.getByRole("button", { name: "Generate brief" }).hasAttribute("disabled"),
    ).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps generation disabled until matrix data is ready", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
    render(<MorningBriefIntro inputs={inputs} matrixReady={false} />)

    expect(
      screen.getByRole("button", { name: "Generate brief" }).hasAttribute("disabled"),
    ).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends the paid request only after a click with explicit intent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ bullets: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ isEmpty: true }), { status: 200 }))

    render(<MorningBriefIntro inputs={inputs} matrixReady />)
    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [, init] = fetchMock.mock.calls[1]
    expect(fetchMock.mock.calls[1][0]).toBe("/api/intel/morning-brief")
    expect(init).toMatchObject({ method: "POST" })
    expect(JSON.parse(String(init?.body))).toMatchObject({ userInitiated: true })
  })
})
