// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

// Phase 7.G LXXXXII — explainer-cache promoted to dual-write (Prisma + memory).
// Tests stub Prisma → calls hit in-memory fallback path via
// `tryPrismaThenFallback` table-missing detection.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  getOrCreateExplanation,
  snapshotHash,
  clearExplainerCacheForTests,
  getExplainerCacheSizeForTests,
  EXPLAINER_CACHE_TTL_MS,
} from "./explainer-cache"
import type { VarianceExplainerInput } from "./variance-explainer"

vi.mock("./variance-explainer", async () => {
  const actual = await vi.importActual<typeof import("./variance-explainer")>("./variance-explainer")
  let callCount = 0
  return {
    ...actual,
    runExplainer: vi.fn(async (_input: VarianceExplainerInput) => {
      callCount++
      return {
        narrative: `mock narrative #${callCount}`,
        recommendations: ["Mock rec 1", "Mock rec 2", "Mock rec 3"],
        confidence: 0.8,
        topDrivers: ["mock_driver"],
        usage: { inputTokens: 100, outputTokens: 50 },
        modelName: "mock-model",
        promptVersion: "v1",
      }
    }),
  }
})

beforeEach(() => {
  clearExplainerCacheForTests()
  vi.clearAllMocks()
})

const baseInput = (overrides: Partial<VarianceExplainerInput> = {}): VarianceExplainerInput => ({
  indicator: {
    code: "REV_GROWTH",
    nameEn: "Revenue Growth",
    unit: "%",
    direction: "higher_better",
    hintTemplateEn: null,
  },
  result: { value: -10, status: "red", period: "2026" },
  resolved: { current_revenue: 100, prev_revenue: 110 },
  aggregates: {},
  company: { name: "AAC", industry: "hospitality" },
  language: "en",
  ...overrides,
})

describe("snapshotHash", () => {
  it("deterministic — same input → same hash", () => {
    expect(snapshotHash(baseInput())).toBe(snapshotHash(baseInput()))
  })

  it("value-sensitive — different IV value → different hash", () => {
    const a = snapshotHash(baseInput({ result: { value: -10, status: "red", period: "2026" } }))
    const b = snapshotHash(baseInput({ result: { value: -20, status: "red", period: "2026" } }))
    expect(a).not.toBe(b)
  })

  it("status-sensitive", () => {
    const a = snapshotHash(baseInput({ result: { value: -10, status: "red", period: "2026" } }))
    const b = snapshotHash(baseInput({ result: { value: -10, status: "amber", period: "2026" } }))
    expect(a).not.toBe(b)
  })

  it("period-sensitive", () => {
    const a = snapshotHash(baseInput({ result: { value: -10, status: "red", period: "2026" } }))
    const b = snapshotHash(baseInput({ result: { value: -10, status: "red", period: "2025" } }))
    expect(a).not.toBe(b)
  })

  it("resolved-inputs-sensitive", () => {
    const a = snapshotHash(baseInput({ resolved: { x: 1 } }))
    const b = snapshotHash(baseInput({ resolved: { x: 2 } }))
    expect(a).not.toBe(b)
  })

  it("company.name-INSENSITIVE (display only)", () => {
    const a = snapshotHash(baseInput({ company: { name: "AAC", industry: "hospitality" } }))
    const b = snapshotHash(baseInput({ company: { name: "LLS", industry: "hospitality" } }))
    expect(a).toBe(b)
  })

  it("industry-sensitive (drives recommendations)", () => {
    const a = snapshotHash(baseInput({ company: { name: "X", industry: "hospitality" } }))
    const b = snapshotHash(baseInput({ company: { name: "X", industry: "agro" } }))
    expect(a).not.toBe(b)
  })
})

describe("getOrCreateExplanation", () => {
  it("cold-start: writes cache + cacheHit=false", async () => {
    expect(getExplainerCacheSizeForTests()).toBe(0)
    const r = await getOrCreateExplanation(baseInput(), {
      orgId: "org_a",
      indicatorValueId: "iv_1",
    })
    expect(r.cacheHit).toBe(false)
    expect(r.output.narrative).toBe("mock narrative #1")
    expect(getExplainerCacheSizeForTests()).toBe(1)
  })

  it("warm-cache: second call → cacheHit=true + same output as r1", async () => {
    const r1 = await getOrCreateExplanation(baseInput(), {
      orgId: "org_a",
      indicatorValueId: "iv_1",
    })
    const r2 = await getOrCreateExplanation(baseInput(), {
      orgId: "org_a",
      indicatorValueId: "iv_1",
    })
    expect(r1.cacheHit).toBe(false)
    expect(r2.cacheHit).toBe(true)
    expect(r2.output.narrative).toBe(r1.output.narrative) // same instance returned
  })

  it("multi-tenant isolation: org_a hit doesn't help org_b", async () => {
    await getOrCreateExplanation(baseInput(), {
      orgId: "org_a",
      indicatorValueId: "iv_1",
    })
    const r = await getOrCreateExplanation(baseInput(), {
      orgId: "org_b",
      indicatorValueId: "iv_1",
    })
    expect(r.cacheHit).toBe(false)
    expect(getExplainerCacheSizeForTests()).toBe(2)
  })

  it("language isolation: en cache doesn't satisfy ru request", async () => {
    await getOrCreateExplanation(baseInput({ language: "en" }), {
      orgId: "org_a",
      indicatorValueId: "iv_1",
    })
    const r = await getOrCreateExplanation(baseInput({ language: "ru" }), {
      orgId: "org_a",
      indicatorValueId: "iv_1",
    })
    expect(r.cacheHit).toBe(false)
    expect(getExplainerCacheSizeForTests()).toBe(2)
  })

  it("snapshot hash change invalidates cache (e.g. recompute changed value)", async () => {
    await getOrCreateExplanation(baseInput({ result: { value: -10, status: "red", period: "2026" } }), {
      orgId: "org_a",
      indicatorValueId: "iv_1",
    })
    const r = await getOrCreateExplanation(baseInput({ result: { value: -20, status: "red", period: "2026" } }), {
      orgId: "org_a",
      indicatorValueId: "iv_1",
    })
    expect(r.cacheHit).toBe(false)
  })

  it("bypassCache=true: always calls LLM", async () => {
    const r1 = await getOrCreateExplanation(baseInput(), {
      orgId: "org_a",
      indicatorValueId: "iv_1",
    })
    const r2 = await getOrCreateExplanation(baseInput(), {
      orgId: "org_a",
      indicatorValueId: "iv_1",
      bypassCache: true,
    })
    expect(r1.cacheHit).toBe(false)
    expect(r2.cacheHit).toBe(false)
    expect(r2.output.narrative).not.toBe(r1.output.narrative) // fresh call
  })

  it("EXPLAINER_CACHE_TTL_MS is 24 hours", () => {
    expect(EXPLAINER_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })

  // Phase 7.G Turn LXXXXVI (E.1b) — intel context invalidates cache
  it("intelContext signature change invalidates cache (fresh intel → fresh narrative)", async () => {
    const intelV1 = {
      fx: [{ metric: "AZN_USD", datetime: "2026-05-10T00:00:00.000Z", value: 0.58, unit: "USD/AZN" }],
      cpi: [],
      commodities: [],
      signature: "intel-sig-v1",
      empty: false,
    }
    const intelV2 = { ...intelV1, signature: "intel-sig-v2" }
    // First call with v1 intel — cache miss, writes
    const r1 = await getOrCreateExplanation(
      baseInput({ intelContext: intelV1 }),
      { orgId: "org_a", indicatorValueId: "iv_1" },
    )
    expect(r1.cacheHit).toBe(false)
    // Second call with v2 intel (signature changed) — cache miss again
    const r2 = await getOrCreateExplanation(
      baseInput({ intelContext: intelV2 }),
      { orgId: "org_a", indicatorValueId: "iv_1" },
    )
    expect(r2.cacheHit).toBe(false)
    // Third call with v1 intel again — cache HIT (still cached)
    const r3 = await getOrCreateExplanation(
      baseInput({ intelContext: intelV1 }),
      { orgId: "org_a", indicatorValueId: "iv_1" },
    )
    expect(r3.cacheHit).toBe(true)
  })

  it("snapshotHash includes intelSignature (different intel → different hash)", () => {
    const a = snapshotHash(baseInput({
      intelContext: { fx: [], cpi: [], commodities: [], signature: "abc123", empty: true },
    }))
    const b = snapshotHash(baseInput({
      intelContext: { fx: [], cpi: [], commodities: [], signature: "xyz789", empty: true },
    }))
    expect(a).not.toBe(b)
  })

  it("snapshotHash same when intelContext omitted (backwards compat with v1 callers)", () => {
    const a = snapshotHash(baseInput()) // no intelContext
    const b = snapshotHash(baseInput()) // no intelContext
    expect(a).toBe(b)
  })

  it("LLM throw propagates (graceful degradation = caller's job)", async () => {
    const { runExplainer } = await import("./variance-explainer")
    vi.mocked(runExplainer).mockRejectedValueOnce(new Error("LLM down"))
    await expect(
      getOrCreateExplanation(baseInput(), {
        orgId: "org_a",
        indicatorValueId: "iv_err",
      }),
    ).rejects.toThrow(/LLM down/)
    // Did NOT cache the failure
    expect(getExplainerCacheSizeForTests()).toBe(0)
  })
})
