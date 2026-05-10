// @vitest-environment node
/**
 * Phase 7.G Turn CIV (Phase 7.E #3 v2 E.2e LLM wire) — runner tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "mock-model",
  getAnthropicClient: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  runBreachDigest,
  BreachDigestEmptyError,
} from "./run-breach-digest"
import {
  evaluateAndPersistBreaches,
  clearBreachMemoryForTests,
} from "./breach-persist"
import { clearBudgetForTests } from "@/lib/llm/cost-budget"
import type { ForecastedBreach } from "./breach-forecaster"

const ORG = "org_demo"

const sampleBreach = (overrides: Partial<ForecastedBreach> = {}): ForecastedBreach => ({
  indicatorCode: "REV_GROWTH",
  companyId: "co_aac",
  period: "2026-Q1",
  horizonStep: 1,
  currentStatus: "green",
  predictedStatus: "amber",
  forecastConfidence: 0.85,
  confidenceBand: "high",
  predictedValue: 75,
  ...overrides,
})

interface FakeMessage {
  content: Array<{ type: string; text?: string }>
  stop_reason: string
  model?: string
  usage?: { input_tokens: number; output_tokens: number }
}

function fakeResponse(text: string, overrides: Partial<FakeMessage> = {}): FakeMessage {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    model: "claude-sonnet-4-5-20250929",
    usage: { input_tokens: 800, output_tokens: 50 },
    ...overrides,
  }
}

function makeClient(response: FakeMessage | (() => Promise<FakeMessage>)) {
  const create =
    typeof response === "function"
      ? vi.fn(response)
      : vi.fn().mockResolvedValue(response)
  return {
    messages: { create },
  } as unknown as ReturnType<typeof import("@/lib/ai/client").getAnthropicClient>
}

beforeEach(() => {
  clearBreachMemoryForTests()
  clearBudgetForTests()
})

describe("runBreachDigest — happy path", () => {
  it("fetches → ranks → calls LLM → returns narrative + audit-status", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ companyId: "co_aac", predictedStatus: "red", confidenceBand: "high" }),
      sampleBreach({ companyId: "co_lls", predictedStatus: "amber", confidenceBand: "medium" }),
    ])
    const client = makeClient(
      fakeResponse(JSON.stringify({ narrative: "Two companies trending red next quarter." })),
    )
    const result = await runBreachDigest(
      { organizationId: ORG, period: "2026-Q1" },
      { client, skipBudget: true },
    )
    expect(result.digest.narrative).toBe("Two companies trending red next quarter.")
    expect(result.breachesAnalyzed).toBe(2)
    expect(result.digest.modelName).toBe("claude-sonnet-4-5-20250929")
    expect(result.digest.topCompanies).toContain("co_aac")
    expect(result.digest.usage).toEqual({ inputTokens: 800, outputTokens: 50 })
  })

  it("threads selectOpts through to ranking", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ companyId: "co_a", confidenceBand: "high" }),
      sampleBreach({ companyId: "co_b", confidenceBand: "low" }),
    ])
    const client = makeClient(
      fakeResponse(JSON.stringify({ narrative: "Single high-confidence breach." })),
    )
    const result = await runBreachDigest(
      {
        organizationId: ORG,
        period: "2026-Q1",
        selectOpts: { minConfidenceBand: "high" },
      },
      { client, skipBudget: true },
    )
    expect(result.breachesAnalyzed).toBe(1) // co_b dropped
    expect(result.digest.topCompanies).toEqual(["co_a"])
  })

  it("propagates language to prompt (RU label appears in user message)", async () => {
    await evaluateAndPersistBreaches(ORG, [sampleBreach()])
    let capturedSystem: string | null = null
    let capturedUser: string | null = null
    const client = {
      messages: {
        create: vi.fn(
          async (args: { system: string; messages: Array<{ content: string }> }) => {
            capturedSystem = args.system
            capturedUser = args.messages[0].content
            return fakeResponse(JSON.stringify({ narrative: "ok" }))
          },
        ),
      },
    } as unknown as ReturnType<typeof import("@/lib/ai/client").getAnthropicClient>
    await runBreachDigest(
      { organizationId: ORG, period: "2026-Q1", language: "ru" },
      { client, skipBudget: true },
    )
    expect(capturedSystem).toContain("CFO")
    expect(capturedUser).toContain("Russian")
  })
})

describe("runBreachDigest — failure modes", () => {
  it("throws BreachDigestEmptyError when no breaches survive ranking", async () => {
    // No breaches at all
    const client = makeClient(fakeResponse(""))
    await expect(
      runBreachDigest({ organizationId: ORG, period: "2026-Q1" }, { client, skipBudget: true }),
    ).rejects.toBeInstanceOf(BreachDigestEmptyError)
  })

  it("BreachDigestEmptyError fires BEFORE LLM call", async () => {
    const create = vi.fn(async () => fakeResponse(""))
    const client = { messages: { create } } as unknown as ReturnType<
      typeof import("@/lib/ai/client").getAnthropicClient
    >
    await expect(
      runBreachDigest({ organizationId: ORG, period: "2026-Q1" }, { client, skipBudget: true }),
    ).rejects.toBeInstanceOf(BreachDigestEmptyError)
    expect(create).not.toHaveBeenCalled()
  })

  it("throws on max_tokens stop_reason", async () => {
    await evaluateAndPersistBreaches(ORG, [sampleBreach()])
    const client = makeClient(
      fakeResponse(JSON.stringify({ narrative: "truncated…" }), { stop_reason: "max_tokens" }),
    )
    await expect(
      runBreachDigest({ organizationId: ORG, period: "2026-Q1" }, { client, skipBudget: true }),
    ).rejects.toThrow(/truncated at max_tokens/)
  })

  it("throws when response has no text blocks", async () => {
    await evaluateAndPersistBreaches(ORG, [sampleBreach()])
    const client = makeClient({
      content: [{ type: "tool_use" }],
      stop_reason: "end_turn",
    })
    await expect(
      runBreachDigest({ organizationId: ORG, period: "2026-Q1" }, { client, skipBudget: true }),
    ).rejects.toThrow(/no text content/)
  })

  it("throws on invalid JSON in response", async () => {
    await evaluateAndPersistBreaches(ORG, [sampleBreach()])
    const client = makeClient(fakeResponse("this is not JSON at all"))
    await expect(
      runBreachDigest({ organizationId: ORG, period: "2026-Q1" }, { client, skipBudget: true }),
    ).rejects.toThrow(/(JSON|did not contain valid JSON)/i)
  })

  it("throws on schema-violating JSON (missing narrative field)", async () => {
    await evaluateAndPersistBreaches(ORG, [sampleBreach()])
    const client = makeClient(fakeResponse(JSON.stringify({ wrong_field: "x" })))
    await expect(
      runBreachDigest({ organizationId: ORG, period: "2026-Q1" }, { client, skipBudget: true }),
    ).rejects.toThrow(/'narrative'/)
  })
})

describe("runBreachDigest — cost-budget integration", () => {
  it("default (no skipBudget) → withTokenBudget enforces caps", async () => {
    await evaluateAndPersistBreaches(ORG, [sampleBreach()])
    const client = makeClient(
      fakeResponse(JSON.stringify({ narrative: "ok" }), {
        usage: { input_tokens: 100, output_tokens: 30 },
      }),
    )
    const result = await runBreachDigest(
      { organizationId: ORG, period: "2026-Q1" },
      { client },
    )
    // Successful call → usage recorded
    expect(result.digest.narrative).toBe("ok")
  })

  it("over-budget call → throws 429-tagged error", async () => {
    await evaluateAndPersistBreaches(ORG, [sampleBreach()])
    const client = makeClient(fakeResponse(JSON.stringify({ narrative: "ok" })))
    // Tiny budget: pre-check fires before LLM call
    const tinyBudget = { daily: 1, monthly: 10 }
    // Pre-record usage to force daily-cap
    const { recordUsage } = await import("@/lib/llm/cost-budget")
    await recordUsage(ORG, { inputTokens: 5, outputTokens: 0 })
    await expect(
      runBreachDigest({ organizationId: ORG, period: "2026-Q1", budget: tinyBudget }, { client }),
    ).rejects.toMatchObject({ status: 429 })
  })

  it("skipBudget=true → bypasses budget check (LLM call always proceeds)", async () => {
    await evaluateAndPersistBreaches(ORG, [sampleBreach()])
    const { recordUsage } = await import("@/lib/llm/cost-budget")
    // Pre-fill usage above default cap; skipBudget should ignore this
    await recordUsage(ORG, { inputTokens: 10_000_000, outputTokens: 0 })
    const client = makeClient(fakeResponse(JSON.stringify({ narrative: "ok" })))
    const result = await runBreachDigest(
      { organizationId: ORG, period: "2026-Q1" },
      { client, skipBudget: true },
    )
    expect(result.digest.narrative).toBe("ok")
  })
})

describe("runBreachDigest — audit emit", () => {
  it("auditPersisted=false when audit table missing (logger never-throws)", async () => {
    await evaluateAndPersistBreaches(ORG, [sampleBreach()])
    const client = makeClient(fakeResponse(JSON.stringify({ narrative: "ok" })))
    const result = await runBreachDigest(
      { organizationId: ORG, period: "2026-Q1" },
      { client, skipBudget: true },
    )
    // prisma is mocked as {} → audit insert fails gracefully
    expect(result.auditPersisted).toBe(false)
  })

  it("audit metadata captures topCompanies + breachCount + tokens + model", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ companyId: "co_a", predictedStatus: "red", confidenceBand: "high" }),
      sampleBreach({ companyId: "co_b", predictedStatus: "red", confidenceBand: "high" }),
    ])
    const client = makeClient(
      fakeResponse(JSON.stringify({ narrative: "ok" }), {
        usage: { input_tokens: 800, output_tokens: 60 },
      }),
    )
    const result = await runBreachDigest(
      { organizationId: ORG, period: "2026-Q1" },
      { client, skipBudget: true },
    )
    expect(result.digest.topCompanies).toEqual(expect.arrayContaining(["co_a", "co_b"]))
    expect(result.breachesAnalyzed).toBe(2)
    expect(result.digest.usage).toEqual({ inputTokens: 800, outputTokens: 60 })
  })
})
