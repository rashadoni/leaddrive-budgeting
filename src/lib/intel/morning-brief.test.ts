/**
 * Tests for `morning-brief.ts` — LLM-mocked.
 * Mirror of news-summary / sentiment test pattern.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "mock-model",
  getAnthropicClient: vi.fn(),
}))

import { runMorningBrief, type MorningBriefInput } from "./morning-brief"
import { getAnthropicClient } from "@/lib/ai/client"

const mockedGetClient = vi.mocked(getAnthropicClient)

function makeInput(over: Partial<MorningBriefInput> = {}): MorningBriefInput {
  return {
    worstCells: [
      { companyCode: "AAC", indicatorCode: "IND_NET_MARGIN", value: -5.3, unit: "%" },
    ],
    topMovers: [
      { companyCode: "AZMADE", indicatorCode: "IND_GROSS_MARGIN", deltaPct: -12.4 },
    ],
    activeAlerts: [
      { severity: "critical", message: "AAC OpEx ratio above ceiling" },
    ],
    newsBullets: ["Cocoa price up 12% — pressure on AAC margin Q3"],
    language: "ru",
    ...over,
  }
}

function fakeResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 200, output_tokens: 80 },
  }
}

function installFakeClient(text: string) {
  mockedGetClient.mockReturnValue({
    messages: { create: vi.fn().mockResolvedValue(fakeResponse(text)) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

beforeEach(() => {
  mockedGetClient.mockReset()
})

describe("runMorningBrief", () => {
  it("parses headline / narrative / priorityAction shape", async () => {
    installFakeClient(
      JSON.stringify({
        headline: "AAC под давлением",
        narrative: "AAC показал отрицательную чистую маржу. Цены на какао выросли.",
        priorityAction: "Пересчитать прогноз себестоимости AAC на Q3",
      }),
    )
    const out = await runMorningBrief(makeInput())
    expect(out.headline).toBe("AAC под давлением")
    expect(out.narrative).toMatch(/AAC/)
    expect(out.priorityAction).toMatch(/AAC/)
    expect(out.usage.inputTokens).toBe(200)
  })

  it("throws when response is not parseable JSON", async () => {
    installFakeClient(`{ headline:`)
    await expect(runMorningBrief(makeInput())).rejects.toThrow(/parseable JSON/)
  })

  it("throws when required fields are missing", async () => {
    installFakeClient(JSON.stringify({ headline: "A" }))
    await expect(runMorningBrief(makeInput())).rejects.toThrow(
      /missing required fields/,
    )
  })

  it("trims whitespace from string fields", async () => {
    installFakeClient(
      JSON.stringify({
        headline: "  спокойное утро  ",
        narrative: "  без красных индикаторов.  ",
        priorityAction: "  Обзор сценариев на следующую неделю.  ",
      }),
    )
    const out = await runMorningBrief(makeInput())
    expect(out.headline).toBe("спокойное утро")
    expect(out.narrative).toBe("без красных индикаторов.")
    expect(out.priorityAction).toBe("Обзор сценариев на следующую неделю.")
  })

  it("caps payload arrays to 10 entries before sending", async () => {
    const createSpy = vi.fn().mockResolvedValue(
      fakeResponse(
        JSON.stringify({
          headline: "h",
          narrative: "n",
          priorityAction: "p",
        }),
      ),
    )
    mockedGetClient.mockReturnValue({
      messages: { create: createSpy },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const huge = Array.from({ length: 50 }, (_, i) => ({
      companyCode: `CO${i}`,
      indicatorCode: "IND_X",
      value: i,
      unit: "%",
    }))
    await runMorningBrief(makeInput({ worstCells: huge }))
    const payload = JSON.parse(createSpy.mock.calls[0][0].messages[0].content)
    expect(payload.worstCells).toHaveLength(10)
  })
})
