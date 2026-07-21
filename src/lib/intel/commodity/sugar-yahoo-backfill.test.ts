// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  clearCommodityMemoryForTests,
  getCommodityMemorySize,
} from "./ingest"
import {
  assessSugarYahooHistoricalCoverage,
  runSugarYahooHistoricalBackfill,
} from "./sugar-yahoo-backfill"

const monthEnd = (year: number, month: number) =>
  Math.floor(Date.UTC(year, month, 0, 20) / 1000)

function dailyHistoryResponse(opts: { omitMonth?: number } = {}) {
  const timestamps = Array.from({ length: 12 }, (_, index) => index + 1)
    .filter((month) => month !== opts.omitMonth)
    .map((month) => monthEnd(2025, month))
  return {
    chart: {
      result: [{
        timestamp: timestamps,
        indicators: { quote: [{ close: timestamps.map((_, index) => 15 + index / 10) }] },
      }],
    },
  }
}

beforeEach(() => {
  clearCommodityMemoryForTests()
})

describe("runSugarYahooHistoricalBackfill", () => {
  it("defaults to source-backed dry-run with no writes and honest incomplete coverage", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => dailyHistoryResponse({ omitMonth: 6 }),
    } as Response)
    const result = await runSugarYahooHistoricalBackfill({
      organizationId: "org_demo",
      year: 2025,
      fetchImpl: fetchMock as typeof fetch,
    })
    expect(result.applied).toBe(false)
    expect(result.writeStatus).toBe("dry_run")
    expect(result.points).toHaveLength(11)
    expect(result.coverage).toMatchObject({
      complete: false,
      missingMonths: ["2025-06"],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not load the Prisma-backed ingest module on an isolated dry-run", async () => {
    vi.resetModules()
    let ingestModuleLoaded = false
    vi.doMock("./ingest", () => {
      ingestModuleLoaded = true
      return { ingestCommodityData: vi.fn() }
    })
    const { runSugarYahooHistoricalBackfill: isolatedRun } = await import("./sugar-yahoo-backfill")
    await isolatedRun({
      organizationId: "org_demo",
      year: 2025,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => dailyHistoryResponse(),
      }) as unknown as typeof fetch,
    })
    expect(ingestModuleLoaded).toBe(false)
    vi.doUnmock("./ingest")
  })

  it("uses real daily June close to make coverage complete without fabrication", async () => {
    const response = dailyHistoryResponse()
    const result = await runSugarYahooHistoricalBackfill({
      organizationId: "org_demo",
      year: 2025,
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => response }) as unknown as typeof fetch,
    })
    expect(result.coverage).toMatchObject({ complete: true, missingMonths: [] })
    const june = result.points.find((point) => point.datetime.toISOString() === "2025-06-01T00:00:00.000Z")
    expect(june?.raw).toMatchObject({ aggregation: "last_daily_close" })
  })

  it("replays a single fetched response through idempotent upserts on apply", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => dailyHistoryResponse(),
    } as Response)
    const prisma = {
      intelDataPoint: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    }
    const options = {
      organizationId: "org_demo",
      year: 2025,
      apply: true,
      prisma: prisma as never,
      fetchImpl: fetchMock as typeof fetch,
    }
    const first = await runSugarYahooHistoricalBackfill(options)
    const second = await runSugarYahooHistoricalBackfill(options)
    const { getCommodityMemorySize } = await import("./ingest")
    expect(first.ingest?.pointsWritten).toBe(12)
    expect(first).toMatchObject({ applied: true, writeStatus: "complete" })
    expect(second.ingest?.pointsWritten).toBe(12)
    expect(getCommodityMemorySize()).toBe(12)
    // One source request per explicit run; apply itself does not re-fetch.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("requires an organization id before calling the provider", async () => {
    const fetchMock = vi.fn()
    await expect(runSugarYahooHistoricalBackfill({
      organizationId: " ",
      year: 2025,
      fetchImpl: fetchMock as typeof fetch,
    })).rejects.toThrow(/organizationId/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not report apply success when Yahoo returns zero usable points", async () => {
    const result = await runSugarYahooHistoricalBackfill({
      organizationId: "org_demo",
      year: 2025,
      apply: true,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ chart: { result: [] } }),
      }) as unknown as typeof fetch,
    })
    expect(result.applied).toBe(false)
    expect(result.writeStatus).toBe("not_applied")
    expect(result.ingest).toBeUndefined()
    expect(result.errors.join(" ")).toMatch(/not applied/)
  })

  it("marks a per-row persistence failure as partial instead of claiming a complete apply", async () => {
    let writes = 0
    const prisma = {
      intelDataPoint: {
        upsert: vi.fn().mockImplementation(async () => {
          writes += 1
          if (writes === 5) throw new Error("connection reset during upsert")
        }),
      },
    }
    const result = await runSugarYahooHistoricalBackfill({
      organizationId: "org_demo",
      year: 2025,
      apply: true,
      prisma: prisma as never,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => dailyHistoryResponse(),
      }) as unknown as typeof fetch,
    })
    expect(result).toMatchObject({ applied: false, writeStatus: "partial" })
    expect(result.ingest?.pointsWritten).toBe(11)
    expect(result.errors.join(" ")).toMatch(/partial: wrote 11\/12/)
  })

  it("does not count a P2021 memory fallback as a completed historical apply", async () => {
    const prisma = {
      intelDataPoint: {
        upsert: vi.fn().mockRejectedValue(
          Object.assign(new Error("IntelDataPoint table is missing"), { code: "P2021" }),
        ),
      },
    }
    const result = await runSugarYahooHistoricalBackfill({
      organizationId: "org_demo",
      year: 2025,
      apply: true,
      prisma: prisma as never,
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => dailyHistoryResponse(),
      }) as unknown as typeof fetch,
    })
    expect(result).toMatchObject({
      applied: false,
      writeStatus: "partial",
      ingest: { pointsWritten: 0 },
    })
    expect(result.errors.join(" ")).toMatch(/write failed/)
    expect(getCommodityMemorySize()).toBe(0)
  })

  it("does not let non-month-start or duplicate rows certify historical coverage", () => {
    const canonical = Array.from({ length: 12 }, (_, month) => ({
      sourceCode: "sugar-yahoo-sb-f",
      metric: "SUGAR_RAW_USD_TONNE",
      datetime: new Date(Date.UTC(2025, month, 1)),
      value: 330,
    }))
    const nonCanonical = {
      ...canonical[0],
      datetime: new Date(Date.UTC(2025, 0, 2)),
    }
    const duplicate = { ...canonical[1] }
    const coverage = assessSugarYahooHistoricalCoverage(2025, [
      ...canonical,
      nonCanonical,
      duplicate,
    ])
    expect(coverage).toMatchObject({
      complete: false,
      duplicateMonths: ["2025-02"],
      nonCanonicalPointCount: 1,
    })
  })
})
