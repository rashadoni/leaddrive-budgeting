// @vitest-environment node
/**
 * Phase 7.G Turn LXXXXV — LLM service factory tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { getLLMService, hasLLMConfigured, resetLLMServiceForTests, setMockProposal } from "./index"
import { InMemoryLLMService } from "./in-memory"
import { AnthropicLLMService } from "./anthropic"

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  resetLLMServiceForTests()
  process.env = { ...ORIG_ENV }
  setMockProposal(null)
})

describe("getLLMService factory", () => {
  it("returns InMemoryLLMService when LLM_PROVIDER=in-memory (test env)", () => {
    process.env.LLM_PROVIDER = "in-memory"
    vi.stubEnv("NODE_ENV", "test")
    const svc = getLLMService()
    expect(svc).toBeInstanceOf(InMemoryLLMService)
  })

  it("returns AnthropicLLMService when LLM_PROVIDER=anthropic + key set", () => {
    process.env.LLM_PROVIDER = "anthropic"
    process.env.ANTHROPIC_API_KEY = "test-key"
    const svc = getLLMService()
    expect(svc).toBeInstanceOf(AnthropicLLMService)
  })

  it("defaults to AnthropicLLMService when LLM_PROVIDER unset + key set", () => {
    delete process.env.LLM_PROVIDER
    process.env.ANTHROPIC_API_KEY = "test-key"
    const svc = getLLMService()
    expect(svc).toBeInstanceOf(AnthropicLLMService)
  })

  it("throws when LLM_PROVIDER=anthropic but no key", () => {
    process.env.LLM_PROVIDER = "anthropic"
    delete process.env.ANTHROPIC_API_KEY
    expect(() => getLLMService()).toThrow(/ANTHROPIC_API_KEY is not set/)
  })

  it("throws when LLM_PROVIDER=in-memory in production (Risk #2 mitigation)", () => {
    process.env.LLM_PROVIDER = "in-memory"
    vi.stubEnv("NODE_ENV", "production")
    expect(() => getLLMService()).toThrow(/not allowed in production/)
  })

  it("throws on unknown LLM_PROVIDER value", () => {
    process.env.LLM_PROVIDER = "made-up-vendor"
    expect(() => getLLMService()).toThrow(/Unknown LLM_PROVIDER/)
  })

  it("returns singleton (same instance on second call)", () => {
    process.env.LLM_PROVIDER = "in-memory"
    vi.stubEnv("NODE_ENV", "test")
    const a = getLLMService()
    const b = getLLMService()
    expect(a).toBe(b)
  })

  it("resetLLMServiceForTests breaks singleton", () => {
    process.env.LLM_PROVIDER = "in-memory"
    vi.stubEnv("NODE_ENV", "test")
    const a = getLLMService()
    resetLLMServiceForTests()
    const b = getLLMService()
    expect(a).not.toBe(b)
  })
})

describe("hasLLMConfigured", () => {
  it("returns true when LLM_PROVIDER=in-memory", () => {
    process.env.LLM_PROVIDER = "in-memory"
    delete process.env.ANTHROPIC_API_KEY
    expect(hasLLMConfigured()).toBe(true)
  })

  it("returns true when ANTHROPIC_API_KEY set", () => {
    delete process.env.LLM_PROVIDER
    process.env.ANTHROPIC_API_KEY = "test-key"
    expect(hasLLMConfigured()).toBe(true)
  })

  it("returns false when neither set", () => {
    delete process.env.LLM_PROVIDER
    delete process.env.ANTHROPIC_API_KEY
    expect(hasLLMConfigured()).toBe(false)
  })
})

describe("InMemoryLLMService", () => {
  it("returns canned proposal when set via setMockProposal", async () => {
    process.env.LLM_PROVIDER = "in-memory"
    vi.stubEnv("NODE_ENV", "test")
    setMockProposal({
      summary: "test mock",
      overallConfidence: 0.95,
      columns: [{ sourceIndex: 0, role: "code", confidence: 1, reasoning: "stub" }],
      accountTypeOverrides: [],
      anomalies: [],
    })
    const svc = getLLMService()
    const result = await svc.generateMapping({
      sourceFile: "x.xlsx",
      sourceSheet: "S",
      columns: [],
      sampleRows: [],
    })
    expect(result.proposal.summary).toBe("test mock")
    expect(result.proposal.overallConfidence).toBe(0.95)
    expect(result.usage.modelName).toBe("in-memory")
    expect(result.usage.inputTokens).toBe(0)
  })

  it("returns default empty proposal when no mock set", async () => {
    process.env.LLM_PROVIDER = "in-memory"
    vi.stubEnv("NODE_ENV", "test")
    setMockProposal(null)
    const svc = getLLMService()
    const result = await svc.generateMapping({
      sourceFile: "x.xlsx",
      sourceSheet: "S",
      columns: [],
      sampleRows: [],
    })
    expect(result.proposal.summary).toMatch(/in-memory stub/)
  })
})
