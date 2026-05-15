/**
 * Tests for `sentiment.ts` — LLM-mocked.
 *
 * Mirror of forecast-explainer.test.ts pattern: vi.mock the Anthropic
 * client, inject fake responses, assert on parse + clamp + edge-case
 * resilience.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "mock-model",
  getAnthropicClient: vi.fn(),
}))

import { runSentimentBatch, type SentimentInputItem } from "./sentiment"
import { getAnthropicClient } from "@/lib/ai/client"

const mockedGetClient = vi.mocked(getAnthropicClient)

function items(n: number): SentimentInputItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i + 1}`,
    title: `Title ${i + 1}`,
    summary: `Summary ${i + 1}`,
    companyTags: [],
    industryTags: [],
  }))
}

function fakeResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 40 },
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

describe("runSentimentBatch", () => {
  it("returns empty result for empty input without LLM call", async () => {
    const out = await runSentimentBatch([])
    expect(out.scores.size).toBe(0)
    expect(out.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(mockedGetClient).not.toHaveBeenCalled()
  })

  it("parses scores keyed by id", async () => {
    installFakeClient(
      JSON.stringify({
        scores: [
          { id: "item-1", score: 0.5 },
          { id: "item-2", score: -0.3 },
        ],
      }),
    )
    const out = await runSentimentBatch(items(2))
    expect(out.scores.get("item-1")).toBe(0.5)
    expect(out.scores.get("item-2")).toBe(-0.3)
  })

  it("clamps out-of-range scores into [-1, 1]", async () => {
    installFakeClient(
      JSON.stringify({
        scores: [
          { id: "item-1", score: 2.5 },
          { id: "item-2", score: -10 },
        ],
      }),
    )
    const out = await runSentimentBatch(items(2))
    expect(out.scores.get("item-1")).toBe(1)
    expect(out.scores.get("item-2")).toBe(-1)
  })

  it("skips entries with non-string id or non-finite score", async () => {
    installFakeClient(
      JSON.stringify({
        scores: [
          { id: "item-1", score: 0.4 },
          { id: 42, score: 0.5 },
          { id: "item-3", score: "bad" },
          { id: "item-4", score: NaN },
          { id: "item-5", score: 0.1 },
        ],
      }),
    )
    const out = await runSentimentBatch(items(5))
    expect(out.scores.size).toBe(2)
    expect(out.scores.get("item-1")).toBe(0.4)
    expect(out.scores.get("item-5")).toBe(0.1)
  })

  it("returns empty scores when LLM emits malformed JSON", async () => {
    installFakeClient(`{ "scores": [{`)
    await expect(runSentimentBatch(items(1))).rejects.toThrow(/parseable JSON/)
  })

  it("returns empty scores when LLM omits scores array", async () => {
    installFakeClient(JSON.stringify({ message: "ok" }))
    const out = await runSentimentBatch(items(1))
    expect(out.scores.size).toBe(0)
  })

  it("rejects batch sizes above MAX_BATCH_SIZE", async () => {
    await expect(runSentimentBatch(items(51))).rejects.toThrow(/MAX_BATCH_SIZE/)
  })

  it("propagates token usage", async () => {
    installFakeClient(JSON.stringify({ scores: [] }))
    const out = await runSentimentBatch(items(1))
    expect(out.usage.inputTokens).toBe(100)
    expect(out.usage.outputTokens).toBe(40)
  })
})

// Phase 7.I — sector-aware prompt (agro/sugar heuristics).
// LLM behavior is mocked, so this asserts the SYSTEM_PROMPT text is the
// one the LLM sees — we capture the `system` field on the mocked
// `messages.create` call. Locks the prompt-as-contract: a future
// inadvertent removal of sugar/agro heuristics breaks loudly.
describe("runSentimentBatch — Phase 7.I sector-aware prompt", () => {
  it("system prompt carries the sugar/agro heuristics block when LLM is invoked", async () => {
    const createMock = vi.fn().mockResolvedValue(fakeResponse(JSON.stringify({ scores: [] })))
    mockedGetClient.mockReturnValue({
      messages: { create: createMock },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    await runSentimentBatch(items(1))
    expect(createMock).toHaveBeenCalledTimes(1)
    const sentSystem = createMock.mock.calls[0][0].system as string
    // The canonical sugar/agro heuristics block tokens.
    expect(sentSystem).toMatch(/AGRO \/ FOOD_PROCESSING/)
    expect(sentSystem).toMatch(/ICE Sugar #11/)
    expect(sentSystem).toMatch(/Salyan|Imishli/i)
    expect(sentSystem).toMatch(/fertilizer|NPK|urea/i)
  })

  it("preserves the base scoring contract while the sector heuristics are present", async () => {
    installFakeClient(
      JSON.stringify({
        scores: [
          { id: "item-1", score: 0.7 }, // simulating: "ICE Sugar spike → bullish"
          { id: "item-2", score: -0.6 }, // simulating: "drought in Salyan → bearish"
        ],
      }),
    )
    const out = await runSentimentBatch(items(2))
    expect(out.scores.get("item-1")).toBe(0.7)
    expect(out.scores.get("item-2")).toBe(-0.6)
  })
})
