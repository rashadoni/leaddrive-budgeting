// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  ingestCommodityData,
  clearCommodityMemoryForTests,
  getCommodityMemorySize,
  getInMemoryDataPoints,
} from "./ingest"
import type { CommodityAdapter, CommodityDataPoint } from "./types"

const ORG = "org_demo"
const NOW = new Date("2026-05-10T20:00:00.000Z")

beforeEach(() => {
  clearCommodityMemoryForTests()
})

function makeAdapter(
  source: string,
  points: CommodityDataPoint[],
  errors: string[] = [],
): CommodityAdapter {
  return {
    source,
    label: source,
    fetch: vi.fn(async () => ({ source, dataPoints: points, errors, fetched: true })),
  }
}

const sample = (overrides: Partial<CommodityDataPoint> = {}): CommodityDataPoint => ({
  sourceCode: "test",
  metric: "M1",
  datetime: NOW,
  value: 1.0,
  unit: "X",
  raw: null,
  ...overrides,
})

describe("ingestCommodityData — happy path (in-memory fallback)", () => {
  it("loops adapters + writes data points to in-memory (Prisma table missing)", async () => {
    const a1 = makeAdapter("src_a", [sample({ sourceCode: "src_a", metric: "USD_AZN", value: 0.58 })])
    const a2 = makeAdapter("src_b", [
      sample({ sourceCode: "src_b", metric: "AZ_CPI", value: 9.7 }),
      sample({ sourceCode: "src_b", metric: "RU_CPI", value: 7.5 }),
    ])
    const result = await ingestCommodityData(ORG, [a1, a2], {}, NOW)
    expect(result.pointsWritten).toBe(3)
    expect(result.perSource).toHaveLength(2)
    expect(getCommodityMemorySize()).toBe(3)
  })

  it("multi-tenant isolation: org_a doesn't see org_b's points", async () => {
    const adapter = makeAdapter("src_a", [sample({ sourceCode: "src_a", metric: "M1" })])
    await ingestCommodityData("org_a", [adapter], {}, NOW)
    await ingestCommodityData("org_b", [adapter], {}, NOW)
    expect(getInMemoryDataPoints("org_a")).toHaveLength(1)
    expect(getInMemoryDataPoints("org_b")).toHaveLength(1)
    expect(getInMemoryDataPoints("org_a")[0].organizationId).toBe("org_a")
  })

  it("getInMemoryDataPoints filters by sourceCode", async () => {
    const adapter = makeAdapter("src_a", [
      sample({ sourceCode: "src_a", metric: "M1" }),
      sample({ sourceCode: "src_a", metric: "M2" }),
    ])
    const adapter2 = makeAdapter("src_b", [sample({ sourceCode: "src_b", metric: "M3" })])
    await ingestCommodityData(ORG, [adapter, adapter2], {}, NOW)
    expect(getInMemoryDataPoints(ORG)).toHaveLength(3)
    expect(getInMemoryDataPoints(ORG, "src_a")).toHaveLength(2)
    expect(getInMemoryDataPoints(ORG, "src_b")).toHaveLength(1)
  })

  it("idempotent: re-ingest same point overwrites (memory key dedups)", async () => {
    const adapter = makeAdapter("src_a", [
      sample({ sourceCode: "src_a", metric: "M1", value: 1.0 }),
    ])
    await ingestCommodityData(ORG, [adapter], {}, NOW)
    expect(getCommodityMemorySize()).toBe(1)
    // Re-run same adapter
    const adapter2 = makeAdapter("src_a", [
      sample({ sourceCode: "src_a", metric: "M1", value: 2.0 }),
    ])
    await ingestCommodityData(ORG, [adapter2], {}, NOW)
    expect(getCommodityMemorySize()).toBe(1) // still 1 (overwritten)
    expect(getInMemoryDataPoints(ORG)[0].value).toBe(2.0) // newest wins
  })
})

describe("ingestCommodityData — error handling", () => {
  it("does not turn a missing table into an in-memory success when strict persistence is required", async () => {
    const adapter = makeAdapter("src_a", [sample({ sourceCode: "src_a", metric: "M1" })])
    const prisma = {
      intelDataPoint: {
        upsert: vi.fn().mockRejectedValue(Object.assign(new Error("table missing"), { code: "P2021" })),
      },
    }
    const result = await ingestCommodityData(
      ORG,
      [adapter],
      { prisma: prisma as never, allowInMemoryFallback: false },
      NOW,
    )

    expect(result.pointsWritten).toBe(0)
    expect(result.errors.join(" ")).toMatch(/write failed/)
    expect(getCommodityMemorySize()).toBe(0)
  })

  it("adapter throwing doesn't abort other adapters", async () => {
    const a1: CommodityAdapter = {
      source: "src_a",
      label: "A",
      fetch: vi.fn(async () => {
        throw new Error("API down")
      }),
    }
    const a2 = makeAdapter("src_b", [sample({ sourceCode: "src_b", metric: "M1" })])
    const result = await ingestCommodityData(ORG, [a1, a2], {}, NOW)
    expect(result.pointsWritten).toBe(1)
    expect(result.errors.some((e) => e.includes("Adapter src_a threw"))).toBe(true)
    expect(getCommodityMemorySize()).toBe(1)
  })

  it("adapter errors[] propagate to ingest result.errors", async () => {
    const adapter = makeAdapter("src_a", [], ["upstream returned 503"])
    const result = await ingestCommodityData(ORG, [adapter], {}, NOW)
    expect(result.errors[0]).toContain("src_a: upstream returned 503")
  })

  it("non-finite values dropped + errored", async () => {
    const adapter = makeAdapter("src_a", [
      sample({ sourceCode: "src_a", metric: "M1", value: NaN }),
      sample({ sourceCode: "src_a", metric: "M2", value: Infinity }),
      sample({ sourceCode: "src_a", metric: "M3", value: 1.5 }),
    ])
    const result = await ingestCommodityData(ORG, [adapter], {}, NOW)
    expect(result.pointsWritten).toBe(1) // only M3 written
    expect(result.errors.filter((e) => e.includes("non-finite")).length).toBe(2)
  })

  it("perSource preserves 1:1 envelope from each adapter", async () => {
    const a1 = makeAdapter("src_a", [sample({ sourceCode: "src_a", metric: "M1" })])
    const a2 = makeAdapter("src_b", [], ["b error"])
    const result = await ingestCommodityData(ORG, [a1, a2], {}, NOW)
    expect(result.perSource).toHaveLength(2)
    expect(result.perSource[0].source).toBe("src_a")
    expect(result.perSource[0].dataPoints).toHaveLength(1)
    expect(result.perSource[1].source).toBe("src_b")
    expect(result.perSource[1].errors).toEqual(["b error"])
  })

  it("zero-adapter input → zero results, no errors", async () => {
    const result = await ingestCommodityData(ORG, [], {}, NOW)
    expect(result.pointsWritten).toBe(0)
    expect(result.perSource).toEqual([])
    expect(result.errors).toEqual([])
  })
})
