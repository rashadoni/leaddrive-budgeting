/**
 * Tests for `variance-explainer.ts`.
 * Mocks the Anthropic client (vi.mock) — covers prompt structure +
 * response-handling edge cases (max_tokens, malformed JSON, shape
 * violations, language switching).
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import type { VarianceExplainerInput } from "./variance-explainer"

vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "mock-model",
  getAnthropicClient: vi.fn(),
}))

import { buildExplainerPrompt, runExplainer } from "./variance-explainer"
import { getAnthropicClient } from "@/lib/ai/client"

const mockedGetClient = vi.mocked(getAnthropicClient)

function makeInput(
  overrides: Partial<VarianceExplainerInput> = {},
): VarianceExplainerInput {
  return {
    indicator: {
      code: "IND_OPEX_RATIO",
      nameEn: "OpEx Ratio",
      unit: "%",
      direction: "lower_better",
      hintTemplateEn:
        "Operating expenses are {value}% of revenue. Above 35% suggests overhead bloat.",
    },
    result: { value: 47.5, status: "red", period: "2026" },
    resolved: { revenue: 1_000_000, opex: 475_000, cogs: 600_000 },
    aggregates: {
      budget_line: {
        line_count: 42,
        revenue: 1_000_000,
        cogs: 600_000,
        opex: 475_000,
      },
    },
    company: {
      name: "ATL-TAZ",
      industry: "industrial",
      tags: [],
    },
    language: "en",
    ...overrides,
  }
}

function fakeResponse(
  text: string,
  stopReason: "end_turn" | "max_tokens" = "end_turn",
  model?: string,
) {
  const out: {
    content: { type: string; text: string }[]
    stop_reason: string
    usage: { input_tokens: number; output_tokens: number }
    model?: string
  } = {
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    usage: { input_tokens: 200, output_tokens: 80 },
  }
  if (model !== undefined) out.model = model
  return out
}

function installFakeClient(response: unknown) {
  mockedGetClient.mockReturnValue({
    messages: { create: vi.fn().mockResolvedValue(response) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

beforeEach(() => {
  mockedGetClient.mockReset()
})

// --- buildExplainerPrompt ----------------------------------------------------

describe("buildExplainerPrompt — pure shape", () => {
  it("includes indicator code + name + value + status", () => {
    const prompt = buildExplainerPrompt(makeInput())
    expect(prompt).toContain("IND_OPEX_RATIO")
    expect(prompt).toContain("OpEx Ratio")
    expect(prompt).toContain("Status: red")
    expect(prompt).toContain("Value: 47.5 %")
  })

  it("renders all resolved variables on separate lines", () => {
    const prompt = buildExplainerPrompt(makeInput())
    expect(prompt).toContain("revenue = 1000000")
    expect(prompt).toContain("opex = 475000")
    expect(prompt).toContain("cogs = 600000")
  })

  it("renders empty resolved as a missing-data hint, not an empty section", () => {
    const prompt = buildExplainerPrompt(
      makeInput({ resolved: {}, result: { value: 0, status: "unknown", period: "2026" } }),
    )
    expect(prompt).toContain("missing-data status=unknown")
  })

  it("includes pipeline error when present", () => {
    const prompt = buildExplainerPrompt(
      makeInput({
        result: { value: 215, status: "unknown", period: "2026" },
        error: {
          code: "out_of_range",
          reason: "Value 215% is outside the ±200% plausibility range",
        },
      }),
    )
    expect(prompt).toContain("out_of_range")
    expect(prompt).toContain("plausibility range")
  })

  it("includes company tags when present (admin / cost_centre / rollup_sourced)", () => {
    const prompt = buildExplainerPrompt(
      makeInput({
        company: {
          name: "ATL-MRKZ",
          industry: "industrial",
          tags: ["admin", "cost_centre", "rollup_sourced"],
        },
      }),
    )
    expect(prompt).toContain("admin, cost_centre, rollup_sourced")
  })

  it("renders explicit '(none)' for missing tags", () => {
    const prompt = buildExplainerPrompt(makeInput())
    expect(prompt).toContain("Tags: (none)")
  })

  it("language switches between EN / RU / AZ in output instructions", () => {
    expect(buildExplainerPrompt(makeInput({ language: "en" }))).toContain(
      "English",
    )
    expect(buildExplainerPrompt(makeInput({ language: "ru" }))).toContain(
      "Russian",
    )
    expect(buildExplainerPrompt(makeInput({ language: "az" }))).toContain(
      "Azerbaijani",
    )
  })

  it("aggregates render compactly with first 8 keys per namespace (exact boundary pinned)", () => {
    const big: Record<string, number> = {}
    for (let i = 0; i < 20; i++) big[`k${i}`] = i
    const prompt = buildExplainerPrompt(
      makeInput({ aggregates: { booking: big } }),
    )
    expect(prompt).toContain("booking:")
    // Pin the exact 8-key boundary: keys k0..k7 included, k8..k19 excluded.
    // If `summarizeAggregates` ever drifts from 8 to a different cap, this
    // test fails LOUDLY rather than silently. The cap drives prompt token
    // budget — a regression here = a token-cost regression in production.
    for (let i = 0; i < 8; i++) {
      expect(
        prompt,
        `expected k${i}=${i} to be inside the 8-key window`,
      ).toContain(`k${i}=${i}`)
    }
    for (let i = 8; i < 20; i++) {
      expect(
        prompt,
        `expected k${i}=${i} to be outside the 8-key window`,
      ).not.toContain(`k${i}=${i}`)
    }
  })
})

// --- runExplainer (with mocked Anthropic client) -----------------------------

describe("runExplainer — happy path", () => {
  it("parses well-formed JSON and returns a typed VarianceExplainerOutput", async () => {
    const json = JSON.stringify({
      narrative:
        "OpEx of 475k is 47.5% of revenue, well above the 35% red threshold; main driver is overhead growth outpacing revenue.",
      recommendations: [
        "Freeze headcount in non-revenue functions until OpEx ratio drops below 35%",
        "Renegotiate top-3 facilities contracts (rent + utilities) by Q3",
        "Audit SG&A line-by-line; cut bottom-quartile vendors",
      ],
      confidence: 0.78,
      topDrivers: ["opex", "revenue"],
    })
    installFakeClient(fakeResponse(json))

    const out = await runExplainer(makeInput())
    expect(out.narrative).toContain("475k")
    expect(out.recommendations).toHaveLength(3)
    expect(out.recommendations[0]).toMatch(/^Freeze/)
    expect(out.confidence).toBeCloseTo(0.78)
    expect(out.topDrivers).toEqual(["opex", "revenue"])
    expect(out.usage).toEqual({ inputTokens: 200, outputTokens: 80 })
  })

  it("strips markdown fences if the model wraps the JSON in ```json blocks", async () => {
    const json = JSON.stringify({
      narrative: "ok",
      recommendations: ["a", "b", "c"],
      confidence: 0.5,
      topDrivers: [],
    })
    installFakeClient(fakeResponse("```json\n" + json + "\n```"))
    const out = await runExplainer(makeInput())
    expect(out.narrative).toBe("ok")
  })

  it("caps recommendations at 3 even if model returns more", async () => {
    const json = JSON.stringify({
      narrative: "ok",
      recommendations: ["a", "b", "c", "d", "e"],
      confidence: 0.5,
      topDrivers: [],
    })
    installFakeClient(fakeResponse(json))
    const out = await runExplainer(makeInput())
    expect(out.recommendations).toEqual(["a", "b", "c"])
  })

  it("caps topDrivers at 5", async () => {
    const json = JSON.stringify({
      narrative: "ok",
      recommendations: ["a"],
      confidence: 0.5,
      topDrivers: ["a", "b", "c", "d", "e", "f", "g"],
    })
    installFakeClient(fakeResponse(json))
    const out = await runExplainer(makeInput())
    expect(out.topDrivers).toHaveLength(5)
  })

  // Turn 38 sub-turn 9 — composer test for modelName + promptVersion
  // (compliance audit attestation). Without these the audit row's
  // modelName/promptVersion fields would silently default and the
  // sub-turn-8 fix would be undetectable.
  it("composer: forwards Anthropic SDK model echo into out.modelName", async () => {
    const json = JSON.stringify({
      narrative: "ok",
      recommendations: ["a"],
      confidence: 0.5,
      topDrivers: [],
    })
    installFakeClient(fakeResponse(json, "end_turn", "claude-sonnet-4-5-20250929"))
    const out = await runExplainer(makeInput())
    expect(out.modelName).toBe("claude-sonnet-4-5-20250929")
    expect(out.promptVersion).toBe("v3")
  })

  it("composer: falls back to request-time AI_MODEL constant when SDK omits model field", async () => {
    const json = JSON.stringify({
      narrative: "ok",
      recommendations: ["a"],
      confidence: 0.5,
      topDrivers: [],
    })
    // fakeResponse without 3rd arg → no model field on response envelope.
    installFakeClient(fakeResponse(json))
    const out = await runExplainer(makeInput())
    // AI_MODEL is mocked to "mock-model" at top of this test file.
    expect(out.modelName).toBe("mock-model")
    expect(out.promptVersion).toBe("v3")
  })
})

describe("runExplainer — error paths", () => {
  it("throws explicit error when stop_reason=max_tokens (truncated mid-JSON)", async () => {
    installFakeClient(fakeResponse('{"narrative":"…incomplete', "max_tokens"))
    await expect(runExplainer(makeInput())).rejects.toThrow(/max_tokens=4096/)
  })

  it("throws when no text content in response", async () => {
    installFakeClient({
      content: [{ type: "tool_use" }],
      stop_reason: "end_turn",
    })
    await expect(runExplainer(makeInput())).rejects.toThrow(/no text content/)
  })

  it("throws on malformed JSON that the JSON extractor can't recover", async () => {
    installFakeClient(fakeResponse("Sorry I can't help with that."))
    await expect(runExplainer(makeInput())).rejects.toThrow(/valid JSON/)
  })

  it("throws on missing narrative", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          recommendations: ["a"],
          confidence: 0.5,
          topDrivers: [],
        }),
      ),
    )
    await expect(runExplainer(makeInput())).rejects.toThrow(/narrative/)
  })

  it("throws on empty narrative string (whitespace-only)", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          narrative: "   ",
          recommendations: ["a"],
          confidence: 0.5,
          topDrivers: [],
        }),
      ),
    )
    await expect(runExplainer(makeInput())).rejects.toThrow(/narrative/)
  })

  it("throws on empty recommendations array", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          narrative: "ok",
          recommendations: [],
          confidence: 0.5,
          topDrivers: [],
        }),
      ),
    )
    await expect(runExplainer(makeInput())).rejects.toThrow(/recommendations/)
  })

  it("throws on out-of-range confidence", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          narrative: "ok",
          recommendations: ["a"],
          confidence: 1.5,
          topDrivers: [],
        }),
      ),
    )
    await expect(runExplainer(makeInput())).rejects.toThrow(/confidence/)
  })

  it("throws on NaN confidence (LLM hallucinated 'NaN' literal)", async () => {
    // Some models return `NaN` as a string when uncertain — extractJsonFromText
    // produces NaN as a number after parse, which must fail validation.
    installFakeClient(
      fakeResponse(
        '{"narrative":"ok","recommendations":["a"],"confidence":null,"topDrivers":[]}',
      ),
    )
    await expect(runExplainer(makeInput())).rejects.toThrow(/confidence/)
  })

  it("throws when topDrivers is not an array", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          narrative: "ok",
          recommendations: ["a"],
          confidence: 0.5,
          topDrivers: "opex,revenue",
        }),
      ),
    )
    await expect(runExplainer(makeInput())).rejects.toThrow(/topDrivers/)
  })

  it("throws when a recommendation is not a string (numeric)", async () => {
    installFakeClient(
      fakeResponse(
        JSON.stringify({
          narrative: "ok",
          recommendations: [1, 2, 3],
          confidence: 0.5,
          topDrivers: [],
        }),
      ),
    )
    await expect(runExplainer(makeInput())).rejects.toThrow(/recommendations/)
  })
})

describe("runExplainer — language pass-through", () => {
  it("RU prompt mentions Russian + recommendations come back in mocked language", async () => {
    const create = vi.fn().mockResolvedValue(
      fakeResponse(
        JSON.stringify({
          narrative: "Расходы 47.5% выручки — выше нормы 35%.",
          recommendations: [
            "Заморозить найм в непродуктивных подразделениях до снижения OpEx ниже 35%",
          ],
          confidence: 0.8,
          topDrivers: ["opex"],
        }),
      ),
    )
    mockedGetClient.mockReturnValue({
      messages: { create },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const out = await runExplainer(makeInput({ language: "ru" }))
    expect(out.narrative).toContain("Расходы")
    // Verify the prompt sent to Anthropic mentions RU as output language
    expect(create).toHaveBeenCalledOnce()
    const sentMessages = create.mock.calls[0][0].messages as Array<{
      role: string
      content: string
    }>
    expect(sentMessages[0].content).toContain("Russian")
  })
})
