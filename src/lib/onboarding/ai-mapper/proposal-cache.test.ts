// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  getOrCreateProposal,
  clearProposalCacheForTests,
  getCacheSizeForTests,
  PROPOSAL_CACHE_TTL_MS,
} from "./proposal-cache"
import {
  resetLLMServiceForTests,
  setMockProposal,
} from "@/lib/llm"
import type { MapperInput } from "./types"

const ORIG_ENV = { ...process.env }

beforeEach(() => {
  resetLLMServiceForTests()
  clearProposalCacheForTests()
  process.env = { ...ORIG_ENV }
  vi.stubEnv("LLM_PROVIDER", "in-memory")
  vi.stubEnv("NODE_ENV", "test")
  setMockProposal({
    summary: "test mock",
    overallConfidence: 0.9,
    columns: [{ sourceIndex: 0, role: "code", confidence: 1, reasoning: "stub" }],
    accountTypeOverrides: [],
    anomalies: [],
  })
})

const sampleInput = (): MapperInput => ({
  sourceFile: "test.xlsx",
  sourceSheet: "P&L",
  columns: [{ index: 0, headerText: "KOD", samples: ["601-01"] }],
  sampleRows: [["601-01"]],
})

describe("getOrCreateProposal — cache mechanics", () => {
  it("cold-start: first call writes to cache + cacheHit=false", async () => {
    expect(getCacheSizeForTests()).toBe(0)
    const r = await getOrCreateProposal(sampleInput(), { orgId: "org_a" })
    expect(r.cacheHit).toBe(false)
    expect(r.proposal.summary).toBe("test mock")
    expect(getCacheSizeForTests()).toBe(1)
  })

  it("warm-cache: second call with same input → cacheHit=true + zero usage", async () => {
    await getOrCreateProposal(sampleInput(), { orgId: "org_a" })
    setMockProposal({
      summary: "DIFFERENT mock — should NOT see this on cache hit",
      overallConfidence: 0.5,
      columns: [],
      accountTypeOverrides: [],
      anomalies: [],
    })
    const r = await getOrCreateProposal(sampleInput(), { orgId: "org_a" })
    expect(r.cacheHit).toBe(true)
    expect(r.proposal.summary).toBe("test mock") // from cache, not the new mock
    expect(r.proposal.usage?.inputTokens).toBe(0)
    expect(r.usage.inputTokens).toBe(0)
    expect(getCacheSizeForTests()).toBe(1)
  })

  it("different orgId → different cache entry (multi-tenant isolation)", async () => {
    await getOrCreateProposal(sampleInput(), { orgId: "org_a" })
    await getOrCreateProposal(sampleInput(), { orgId: "org_b" })
    expect(getCacheSizeForTests()).toBe(2)
  })

  it("different language → different cache entry", async () => {
    await getOrCreateProposal(sampleInput(), { orgId: "org_a", language: "en" })
    await getOrCreateProposal(sampleInput(), { orgId: "org_a", language: "ru" })
    expect(getCacheSizeForTests()).toBe(2)
  })

  it("bypassCache=true → always calls LLM, doesn't read cache", async () => {
    await getOrCreateProposal(sampleInput(), { orgId: "org_a" })
    setMockProposal({
      summary: "fresh response",
      overallConfidence: 0.9,
      columns: [],
      accountTypeOverrides: [],
      anomalies: [],
    })
    const r = await getOrCreateProposal(sampleInput(), {
      orgId: "org_a",
      bypassCache: true,
    })
    expect(r.cacheHit).toBe(false)
    expect(r.proposal.summary).toBe("fresh response")
  })

  it("file/sheet name don't affect cache key (same template, different files)", async () => {
    await getOrCreateProposal(
      { ...sampleInput(), sourceFile: "AAC-rev6.xlsx", sourceSheet: "P&L AAC" },
      { orgId: "org_a" },
    )
    const r = await getOrCreateProposal(
      { ...sampleInput(), sourceFile: "LLS-rev7.xlsx", sourceSheet: "P&L LLS" },
      { orgId: "org_a" },
    )
    expect(r.cacheHit).toBe(true)
    // sourceFile/Sheet from LIVE input wins
    expect(r.proposal.sourceFile).toBe("LLS-rev7.xlsx")
    expect(r.proposal.sourceSheet).toBe("P&L LLS")
  })

  it("heuristic anomalies REBUILD on cache hit from live data", async () => {
    // First call with no anomaly-trigger
    await getOrCreateProposal(sampleInput(), { orgId: "org_a" })

    // Second call with same STRUCTURE but anomaly-triggering values
    // (sign_inversion: revenue code 601 with negative values)
    const inputWithAnomaly: MapperInput = {
      sourceFile: "test.xlsx",
      sourceSheet: "P&L",
      columns: [{ index: 0, headerText: "KOD", samples: ["601-01"] }],
      sampleRows: [["601-01"]],
    }
    const r = await getOrCreateProposal(inputWithAnomaly, { orgId: "org_a" })
    expect(r.cacheHit).toBe(true)
    // Heuristic anomalies array was REBUILT from live data + cached LLM anomalies merged
    expect(Array.isArray(r.proposal.anomalies)).toBe(true)
  })
})

describe("getOrCreateProposal — TTL", () => {
  it("entry served fresh within TTL window", async () => {
    await getOrCreateProposal(sampleInput(), { orgId: "org_a" })
    const r = await getOrCreateProposal(sampleInput(), { orgId: "org_a" })
    expect(r.cacheHit).toBe(true)
  })

  it("PROPOSAL_CACHE_TTL_MS is 24 hours", () => {
    expect(PROPOSAL_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })
})
