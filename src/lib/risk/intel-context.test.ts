// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  bucketizeDataPoints,
  computeSignature,
  formatIntelContextForPrompt,
  buildIntelContext,
  INTEL_CONTEXT_WINDOW_MS,
  INTEL_CONTEXT_MAX_PER_METRIC,
} from "./intel-context"
import {
  ingestCommodityData,
  clearCommodityMemoryForTests,
  type CommodityAdapter,
  type CommodityDataPoint,
} from "@/lib/intel/commodity"

const NOW = new Date("2026-05-10T20:00:00.000Z")
const ORG = "org_demo"

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

beforeEach(() => {
  clearCommodityMemoryForTests()
})

describe("bucketizeDataPoints — pure helper", () => {
  it("groups points by source-bucket (fx / cpi / commodities)", () => {
    const snap = bucketizeDataPoints(
      [
        { sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: NOW, value: 0.58, unit: "USD/AZN" },
        { sourceCode: "worldbank-cpi", metric: "AZ_CPI_YOY", datetime: NOW, value: 9.7, unit: "%" },
        { sourceCode: "commodities-rss", metric: "BRENT_USD_BBL", datetime: NOW, value: 76.42, unit: "USD/bbl" },
      ],
      NOW,
    )
    expect(snap.fx).toHaveLength(1)
    expect(snap.cpi).toHaveLength(1)
    expect(snap.commodities).toHaveLength(1)
    expect(snap.empty).toBe(false)
  })

  it("drops points outside 60-day window", () => {
    const snap = bucketizeDataPoints(
      [
        { sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: NOW, value: 0.58 },
        { sourceCode: "tcmb-fx-rates", metric: "AZN_EUR", datetime: daysAgo(70), value: 0.54 },
      ],
      NOW,
    )
    expect(snap.fx.map((o) => o.metric)).toEqual(["AZN_USD"])
  })

  it("caps observations per metric at INTEL_CONTEXT_MAX_PER_METRIC (3)", () => {
    const points: Array<Pick<CommodityDataPoint, "sourceCode" | "metric" | "datetime" | "value" | "unit">> = []
    for (let i = 0; i < 10; i++) {
      points.push({
        sourceCode: "tcmb-fx-rates",
        metric: "AZN_USD",
        datetime: daysAgo(i),
        value: 0.58 + i * 0.01,
      })
    }
    const snap = bucketizeDataPoints(points, NOW)
    expect(snap.fx.length).toBe(INTEL_CONTEXT_MAX_PER_METRIC)
    // Latest first per metric — i=0 (today) value first
    expect(snap.fx[0].value).toBe(0.58)
    expect(snap.fx[1].value).toBe(0.59)
    expect(snap.fx[2].value).toBe(0.6)
  })

  it("handles zero data points → empty=true", () => {
    const snap = bucketizeDataPoints([], NOW)
    expect(snap.empty).toBe(true)
    expect(snap.fx).toEqual([])
    expect(snap.signature).toMatch(/^[a-f0-9]{16}$/)
  })

  it("ignores unknown source codes", () => {
    const snap = bucketizeDataPoints(
      [
        { sourceCode: "unknown-source", metric: "X", datetime: NOW, value: 1 },
        { sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: NOW, value: 0.58 },
      ],
      NOW,
    )
    expect(snap.fx).toHaveLength(1)
    expect(snap.cpi).toEqual([])
    expect(snap.commodities).toEqual([])
  })
})

describe("computeSignature — deterministic", () => {
  it("same input → same signature", () => {
    const a = bucketizeDataPoints(
      [{ sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: NOW, value: 0.58 }],
      NOW,
    )
    const b = bucketizeDataPoints(
      [{ sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: NOW, value: 0.58 }],
      NOW,
    )
    expect(a.signature).toBe(b.signature)
  })

  it("value change → signature change", () => {
    const a = bucketizeDataPoints(
      [{ sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: NOW, value: 0.58 }],
      NOW,
    )
    const b = bucketizeDataPoints(
      [{ sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: NOW, value: 0.59 }],
      NOW,
    )
    expect(a.signature).not.toBe(b.signature)
  })

  it("empty snapshot → stable signature (not random)", () => {
    const a = bucketizeDataPoints([], NOW)
    const b = bucketizeDataPoints([], NOW)
    expect(a.signature).toBe(b.signature)
  })
})

describe("formatIntelContextForPrompt — prompt rendering", () => {
  it("renders fx + cpi + commodities sections when present", () => {
    const snap = bucketizeDataPoints(
      [
        { sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: NOW, value: 0.58, unit: "USD/AZN" },
        { sourceCode: "worldbank-cpi", metric: "AZ_CPI_YOY", datetime: NOW, value: 9.7, unit: "%" },
        { sourceCode: "commodities-rss", metric: "BRENT_USD_BBL", datetime: NOW, value: 76.42, unit: "USD/bbl" },
      ],
      NOW,
    )
    const text = formatIntelContextForPrompt(snap)
    expect(text).toContain("FX rates")
    expect(text).toContain("AZN_USD = 0.58")
    expect(text).toContain("CPI YoY")
    expect(text).toContain("AZ_CPI_YOY = 9.7")
    expect(text).toContain("Commodity spot prices")
    expect(text).toContain("BRENT_USD_BBL = 76.42")
  })

  it("returns null for empty snapshot (caller skips intel block)", () => {
    expect(formatIntelContextForPrompt(bucketizeDataPoints([], NOW))).toBeNull()
  })

  it("omits sections that have no data", () => {
    const snap = bucketizeDataPoints(
      [{ sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: NOW, value: 0.58 }],
      NOW,
    )
    const text = formatIntelContextForPrompt(snap)
    expect(text).toContain("FX rates")
    expect(text).not.toContain("CPI")
    expect(text).not.toContain("Commodity")
  })
})

describe("buildIntelContext — reads from in-memory store via fallback", () => {
  it("returns empty snapshot when no intel data exists", async () => {
    const snap = await buildIntelContext(ORG, { now: NOW })
    expect(snap.empty).toBe(true)
  })

  it("returns populated snapshot after ingestCommodityData runs", async () => {
    const adapter: CommodityAdapter = {
      source: "tcmb-fx-rates",
      label: "TCMB",
      fetch: async () => ({
        source: "tcmb-fx-rates",
        dataPoints: [
          { sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: NOW, value: 0.58 },
        ],
        errors: [],
        fetched: true,
      }),
    }
    await ingestCommodityData(ORG, [adapter], {}, NOW)
    const snap = await buildIntelContext(ORG, { now: NOW })
    expect(snap.empty).toBe(false)
    expect(snap.fx).toHaveLength(1)
    expect(snap.fx[0].metric).toBe("AZN_USD")
  })

  it("multi-tenant: org_a snapshot doesn't include org_b data", async () => {
    const adapter: CommodityAdapter = {
      source: "tcmb-fx-rates",
      label: "TCMB",
      fetch: async () => ({
        source: "tcmb-fx-rates",
        dataPoints: [
          { sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: NOW, value: 0.58 },
        ],
        errors: [],
        fetched: true,
      }),
    }
    await ingestCommodityData("org_a", [adapter], {}, NOW)
    const snapA = await buildIntelContext("org_a", { now: NOW })
    const snapB = await buildIntelContext("org_b", { now: NOW })
    expect(snapA.empty).toBe(false)
    expect(snapB.empty).toBe(true)
  })

  it("respects custom windowMs", async () => {
    const adapter: CommodityAdapter = {
      source: "tcmb-fx-rates",
      label: "TCMB",
      fetch: async () => ({
        source: "tcmb-fx-rates",
        dataPoints: [
          { sourceCode: "tcmb-fx-rates", metric: "AZN_USD", datetime: daysAgo(10), value: 0.58 },
        ],
        errors: [],
        fetched: true,
      }),
    }
    await ingestCommodityData(ORG, [adapter], {}, NOW)
    // 5-day window: 10-day-old point should be filtered
    const snap = await buildIntelContext(ORG, {
      now: NOW,
      windowMs: 5 * 24 * 60 * 60 * 1000,
    })
    expect(snap.empty).toBe(true)
  })

  it("INTEL_CONTEXT_WINDOW_MS is 60 days", () => {
    expect(INTEL_CONTEXT_WINDOW_MS).toBe(60 * 24 * 60 * 60 * 1000)
  })
})
