/**
 * Phase 7.L — Pure LLM impact-forecast unit tests.
 *
 * Locks the JSON shape contract + validateAndShape guards. Uses an
 * injected mock Anthropic SDK so no real LLM call happens.
 */
import { describe, it, expect, vi } from "vitest"
import { runImpactForecast, type ImpactForecastInput } from "./impact-forecast"

function makeInput(over: Partial<ImpactForecastInput> = {}): ImpactForecastInput {
  return {
    trigger: {
      sourceCode: "fao-food-prices",
      metric: "FAO_FFPI_NOMINAL",
      value: 132,
      baseline: 120,
      deltaPct: 10,
      observedAt: "2026-05-01T00:00:00Z",
    },
    company: {
      code: "AZSEKER-AZSF",
      name: "Azərşəkər Sugar",
      industry: "food_processing",
    },
    companyFinancials: {
      revenueAZN: 12_000_000,
      cogsAZN: 8_400_000,
      opexAZN: 2_000_000,
      ebitdaAZN: 1_600_000,
      period: "2026",
    },
    sectorSensitivity: "high",
    language: "en",
    ...over,
  }
}

function makeValidLlmResponse() {
  return {
    scenarios: {
      best: {
        projectedIndicatorValue: 27.5,
        plDeltaAZN: -200_000,
        deltaPct: -1.5,
        drivers: ["grain ≈ 40% COGS × FAO +5% pass-through = COGS +₼200K"],
        timeHorizon: "next 3 months",
      },
      likely: {
        projectedIndicatorValue: 25.0,
        plDeltaAZN: -500_000,
        deltaPct: -4.2,
        drivers: ["grain ≈ 40% COGS × FAO +10% pass-through = COGS +₼500K"],
        timeHorizon: "Q3 2026",
      },
      worst: {
        projectedIndicatorValue: 22.0,
        plDeltaAZN: -900_000,
        deltaPct: -7.5,
        drivers: ["grain ≈ 40% COGS × FAO +18% pass-through = COGS +₼900K"],
        timeHorizon: "6-month outlook",
      },
    },
    recommendations: [
      "Lock 6-month forward grain contracts at current price",
      "Raise wholesale price 4% on Q3 deliveries",
      "Shift 20% sourcing to RU domestic supplier",
    ],
    confidence: "medium",
  }
}

function makeMockClient(payload: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify(payload) }],
        usage: { input_tokens: 1200, output_tokens: 800 },
      }),
    },
  } as never
}

describe("runImpactForecast", () => {
  it("parses valid LLM response into structured ImpactForecastOutput", async () => {
    const client = makeMockClient(makeValidLlmResponse())
    const result = await runImpactForecast(makeInput(), { client })
    expect(result.scenarios.best.plDeltaAZN).toBe(-200_000)
    expect(result.scenarios.likely.plDeltaAZN).toBe(-500_000)
    expect(result.scenarios.worst.plDeltaAZN).toBe(-900_000)
    expect(result.recommendations).toHaveLength(3)
    expect(result.confidence).toBe("medium")
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 800 })
  })

  it("throws when LLM returns non-JSON text", async () => {
    const client = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "not valid json at all" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    } as never
    await expect(runImpactForecast(makeInput(), { client })).rejects.toThrow(
      /did not return parseable JSON/,
    )
  })

  it("throws when scenarios block missing", async () => {
    const client = makeMockClient({
      recommendations: ["x", "y", "z"],
      confidence: "low",
    })
    await expect(runImpactForecast(makeInput(), { client })).rejects.toThrow(
      /missing scenarios block/,
    )
  })

  it("throws when scenarios.best malformed (missing plDeltaAZN)", async () => {
    const bad = makeValidLlmResponse()
    delete (bad.scenarios.best as Partial<typeof bad.scenarios.best>).plDeltaAZN
    const client = makeMockClient(bad)
    await expect(runImpactForecast(makeInput(), { client })).rejects.toThrow(
      /must each have projectedIndicatorValue/,
    )
  })

  it("throws when recommendations.length !== 3", async () => {
    const bad = makeValidLlmResponse()
    bad.recommendations = ["only", "two"]
    const client = makeMockClient(bad)
    await expect(runImpactForecast(makeInput(), { client })).rejects.toThrow(
      /must be exactly 3 strings/,
    )
  })

  it("throws when confidence not in enum", async () => {
    const bad = makeValidLlmResponse()
    ;(bad as { confidence: string }).confidence = "uncertain"
    const client = makeMockClient(bad)
    await expect(runImpactForecast(makeInput(), { client })).rejects.toThrow(
      /confidence must be 'low'\|'medium'\|'high'/,
    )
  })

  it("passes language through to system prompt", async () => {
    const client = makeMockClient(makeValidLlmResponse())
    await runImpactForecast(makeInput({ language: "ru" }), { client })
    const call = (client as { messages: { create: { mock: { calls: unknown[][] } } } }).messages.create.mock.calls[0][0] as {
      system: string
      messages: Array<{ role: string; content: string }>
    }
    expect(call.system).toContain("RUSSIAN")
  })

  it("includes the company financials in user payload", async () => {
    const client = makeMockClient(makeValidLlmResponse())
    await runImpactForecast(makeInput(), { client })
    const call = (client as { messages: { create: { mock: { calls: unknown[][] } } } }).messages.create.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>
    }
    const userContent = JSON.parse(call.messages[0].content)
    expect(userContent.companyFinancials.revenueAZN).toBe(12_000_000)
    expect(userContent.trigger.metric).toBe("FAO_FFPI_NOMINAL")
    expect(userContent.sectorSensitivity).toBe("high")
  })
})
