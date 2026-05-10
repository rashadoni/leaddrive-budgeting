// @vitest-environment node
/**
 * Phase 7.G Turn LXXXXVIII (Phase 7.E #3 v2 E.2b) — breach persist tests.
 * Tests stub Prisma → calls hit in-memory fallback path via tryPrismaThenFallback.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  evaluateAndPersistBreaches,
  getPredictiveBreaches,
  clearBreaches,
  clearBreachMemoryForTests,
  getBreachMemorySize,
} from "./breach-persist"
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
  predictedLower: 70,
  predictedUpper: 80,
  ...overrides,
})

beforeEach(() => {
  clearBreachMemoryForTests()
})

describe("evaluateAndPersistBreaches — happy path (in-memory fallback)", () => {
  it("writes breaches to memory + returns count", async () => {
    const result = await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ horizonStep: 1 }),
      sampleBreach({ horizonStep: 2 }),
      sampleBreach({ horizonStep: 3 }),
    ])
    expect(result.written).toBe(3)
    expect(result.errors).toEqual([])
    expect(getBreachMemorySize()).toBe(3)
  })

  it("idempotent: re-persist same breach overwrites in place (memory key dedup)", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ horizonStep: 1, predictedValue: 75 }),
    ])
    expect(getBreachMemorySize()).toBe(1)
    // Re-persist with new prediction value
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ horizonStep: 1, predictedValue: 65 }),
    ])
    expect(getBreachMemorySize()).toBe(1) // still 1
    const rows = await getPredictiveBreaches(ORG)
    expect(rows[0].predictedValue).toBe(65) // newest wins
  })

  it("multi-tenant: org_a breach not visible from org_b", async () => {
    await evaluateAndPersistBreaches("org_a", [sampleBreach({ companyId: "co_a1" })])
    await evaluateAndPersistBreaches("org_b", [sampleBreach({ companyId: "co_b1" })])
    expect(await getPredictiveBreaches("org_a")).toHaveLength(1)
    expect(await getPredictiveBreaches("org_b")).toHaveLength(1)
    expect((await getPredictiveBreaches("org_a"))[0].companyId).toBe("co_a1")
  })

  it("threads computedAt timestamp", async () => {
    const before = new Date()
    await evaluateAndPersistBreaches(ORG, [sampleBreach()])
    const after = new Date()
    const rows = await getPredictiveBreaches(ORG)
    expect(rows[0].computedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(rows[0].computedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it("zero breaches → zero written, zero errors", async () => {
    const result = await evaluateAndPersistBreaches(ORG, [])
    expect(result.written).toBe(0)
    expect(result.errors).toEqual([])
  })

  it("threads drivers JSON through", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ drivers: { topDriver: "fx_volatility", magnitude: 0.7 } }),
    ])
    const rows = await getPredictiveBreaches(ORG)
    expect(rows[0].drivers).toMatchObject({ topDriver: "fx_volatility", magnitude: 0.7 })
  })
})

describe("getPredictiveBreaches — read-through with filters", () => {
  it("filters by period", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ period: "2026-Q1" }),
      sampleBreach({ period: "2026-Q2", companyId: "co_b" }),
    ])
    const q1 = await getPredictiveBreaches(ORG, { period: "2026-Q1" })
    const q2 = await getPredictiveBreaches(ORG, { period: "2026-Q2" })
    expect(q1).toHaveLength(1)
    expect(q2).toHaveLength(1)
    expect(q1[0].period).toBe("2026-Q1")
    expect(q2[0].companyId).toBe("co_b")
  })

  it("filters by minConfidenceBand (medium → drops 'low' rows)", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ companyId: "co_a", confidenceBand: "high" }),
      sampleBreach({ companyId: "co_b", confidenceBand: "medium" }),
      sampleBreach({ companyId: "co_c", confidenceBand: "low" }),
    ])
    const filtered = await getPredictiveBreaches(ORG, { minConfidenceBand: "medium" })
    expect(filtered.length).toBe(2)
    const bands = filtered.map((b) => b.confidenceBand).sort()
    expect(bands).toEqual(["high", "medium"])
  })

  it("filters by minConfidenceBand=high → only high rows", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ companyId: "co_a", confidenceBand: "high" }),
      sampleBreach({ companyId: "co_b", confidenceBand: "medium" }),
    ])
    const filtered = await getPredictiveBreaches(ORG, { minConfidenceBand: "high" })
    expect(filtered.length).toBe(1)
    expect(filtered[0].confidenceBand).toBe("high")
  })

  it("returns empty array when org has no breaches", async () => {
    const rows = await getPredictiveBreaches(ORG)
    expect(rows).toEqual([])
  })

  it("sorts by period desc, horizonStep asc, confidenceBand desc", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ period: "2026-Q1", horizonStep: 2, confidenceBand: "low" }),
      sampleBreach({ period: "2026-Q2", horizonStep: 1, confidenceBand: "medium" }),
      sampleBreach({ period: "2026-Q1", horizonStep: 1, confidenceBand: "high" }),
    ])
    const rows = await getPredictiveBreaches(ORG)
    // Q2 first (period desc); within Q1: step 1 before step 2; within step 1: high before low
    expect(rows[0].period).toBe("2026-Q2")
    expect(rows[1].period).toBe("2026-Q1")
    expect(rows[1].horizonStep).toBe(1)
    expect(rows[2].horizonStep).toBe(2)
  })
})

describe("clearBreaches — bulk delete", () => {
  it("clears all rows for an org when no filter", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ horizonStep: 1 }),
      sampleBreach({ horizonStep: 2 }),
    ])
    expect(getBreachMemorySize()).toBe(2)
    const removed = await clearBreaches(ORG)
    expect(removed).toBe(2)
    expect(getBreachMemorySize()).toBe(0)
  })

  it("clears only matching period when period filter", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ period: "2026-Q1" }),
      sampleBreach({ period: "2026-Q2", companyId: "co_b" }),
    ])
    const removed = await clearBreaches(ORG, { period: "2026-Q1" })
    expect(removed).toBe(1)
    expect(getBreachMemorySize()).toBe(1)
    const remaining = await getPredictiveBreaches(ORG)
    expect(remaining[0].period).toBe("2026-Q2")
  })

  it("clears only matching companyId when companyId filter", async () => {
    await evaluateAndPersistBreaches(ORG, [
      sampleBreach({ companyId: "co_a" }),
      sampleBreach({ companyId: "co_b" }),
    ])
    const removed = await clearBreaches(ORG, { companyId: "co_a" })
    expect(removed).toBe(1)
    expect((await getPredictiveBreaches(ORG))[0].companyId).toBe("co_b")
  })

  it("doesn't touch other orgs' rows", async () => {
    await evaluateAndPersistBreaches("org_a", [sampleBreach()])
    await evaluateAndPersistBreaches("org_b", [sampleBreach()])
    await clearBreaches("org_a")
    expect(await getPredictiveBreaches("org_a")).toEqual([])
    expect(await getPredictiveBreaches("org_b")).toHaveLength(1)
  })

  it("returns 0 when no rows match", async () => {
    const removed = await clearBreaches(ORG, { period: "2099-Q1" })
    expect(removed).toBe(0)
  })
})
