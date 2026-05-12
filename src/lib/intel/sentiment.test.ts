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
