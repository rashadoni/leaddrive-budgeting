// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  clearCommodityMemoryForTests,
  getCommodityMemorySize,
  getInMemoryDataPoints,
  ingestCommodityData,
} from "./ingest"
import type { CommodityAdapter } from "./types"
import {
  assessHistoricalRainfallBatch,
  buildHistoricalRainfallUnionRange,
  buildHistoricalRainfallUrl,
  buildLegacyRainfallWindow,
  buildMonthlyRainfallAnchors,
  createOpenMeteoHistoricalRainfallAdapter,
  executeHistoricalRainfallBackfill,
  historicalRainfallResponseToDataPoint,
  LEGACY_RAINFALL_DAY_COUNT,
  type OpenMeteoHistoricalRainfallResponse,
} from "./weather-openmeteo-history"
import { WEATHER_REGIONS } from "./weather-openmeteo"

function dailyDates(windowEnd: string): string[] {
  const window = buildLegacyRainfallWindow(windowEnd)
  const cursor = new Date(`${window.windowStart}T00:00:00.000Z`)
  return Array.from({ length: window.dayCount }, (_, index) => {
    const date = new Date(cursor)
    date.setUTCDate(date.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  })
}

function completeResponse(windowEnd: string, precipitationMm = 1): OpenMeteoHistoricalRainfallResponse {
  return {
    latitude: 39.5,
    longitude: 48.95,
    daily_units: { precipitation_sum: "mm" },
    daily: {
      time: dailyDates(windowEnd),
      precipitation_sum: Array.from(
        { length: LEGACY_RAINFALL_DAY_COUNT },
        () => precipitationMm,
      ),
    },
  }
}

function completeRangeResponse(
  windowStart: string,
  windowEnd: string,
  precipitationMm = 1,
): OpenMeteoHistoricalRainfallResponse {
  const start = new Date(`${windowStart}T00:00:00.000Z`)
  const end = new Date(`${windowEnd}T00:00:00.000Z`)
  const dayCount = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  return {
    latitude: 39.5,
    longitude: 48.95,
    daily_units: { precipitation_sum: "mm" },
    daily: {
      time: Array.from({ length: dayCount }, (_, index) => {
        const date = new Date(start)
        date.setUTCDate(date.getUTCDate() + index)
        return date.toISOString().slice(0, 10)
      }),
      precipitation_sum: Array.from({ length: dayCount }, () => precipitationMm),
    },
  }
}

beforeEach(() => {
  clearCommodityMemoryForTests()
})

describe("Open-Meteo historical rainfall — exact legacy windows", () => {
  it("keeps end-90 through end inclusive across a year boundary", () => {
    expect(buildLegacyRainfallWindow("2025-01-15")).toEqual({
      windowStart: "2024-10-17",
      windowEnd: "2025-01-15",
      dayCount: 91,
    })
  })

  it("builds leap-year month-end anchors and a 91-day Jan-Mar window", () => {
    const anchors = buildMonthlyRainfallAnchors(2024)
    expect(anchors).toHaveLength(12)
    expect(anchors[1]).toBe("2024-02-29")
    expect(anchors.at(-1)).toBe("2024-12-31")
    expect(buildLegacyRainfallWindow("2024-03-31")).toMatchObject({
      windowStart: "2024-01-01",
      windowEnd: "2024-03-31",
      dayCount: 91,
    })
  })

  it("derives one exact union range for all twelve annual anchors", () => {
    expect(buildHistoricalRainfallUnionRange(buildMonthlyRainfallAnchors(2025))).toEqual({
      windowStart: "2024-11-02",
      windowEnd: "2025-12-31",
      dayCount: 425,
    })
  })

  it("builds a free Archive query bounded to the exact region/window", () => {
    const salyan = WEATHER_REGIONS.find((region) => region.code === "salyan")!
    const url = new URL(
      buildHistoricalRainfallUrl(salyan, buildLegacyRainfallWindow("2025-12-31")),
    )
    expect(url.origin + url.pathname).toBe("https://archive-api.open-meteo.com/v1/archive")
    expect(url.searchParams.get("latitude")).toBe(String(salyan.latitude))
    expect(url.searchParams.get("longitude")).toBe(String(salyan.longitude))
    expect(url.searchParams.get("start_date")).toBe("2025-10-02")
    expect(url.searchParams.get("end_date")).toBe("2025-12-31")
    expect(url.searchParams.get("daily")).toBe("precipitation_sum")
    expect(url.searchParams.get("timezone")).toBe("UTC")
    expect(url.searchParams.has("apikey")).toBe(false)
  })
})

describe("Open-Meteo historical rainfall — response quality", () => {
  const salyan = WEATHER_REGIONS.find((region) => region.code === "salyan")!
  const window = buildLegacyRainfallWindow("2025-12-31")

  it("emits one canonical point with explicit 91-day raw evidence", () => {
    const parsed = historicalRainfallResponseToDataPoint(
      salyan,
      window,
      completeResponse(window.windowEnd, 2),
    )
    expect(parsed.error).toBeNull()
    expect(parsed.dataPoint).toMatchObject({
      sourceCode: "weather-openmeteo",
      metric: "SALYAN_RAINFALL_MM_90D",
      value: 182,
      unit: "mm",
      raw: {
        windowStart: "2025-10-02",
        windowEnd: "2025-12-31",
        dayCount: 91,
        receivedDayCount: 91,
        windowSemantics: "inclusive_end_minus_90_days_through_end",
      },
    })
    expect(parsed.dataPoint?.datetime.toISOString()).toBe("2025-12-31T00:00:00.000Z")
  })

  it("fails closed on a partial 90/91 response", () => {
    const response = completeResponse(window.windowEnd)
    response.daily!.precipitation_sum = response.daily!.precipitation_sum!.slice(0, -1)
    const parsed = historicalRainfallResponseToDataPoint(salyan, window, response)
    expect(parsed.dataPoint).toBeNull()
    expect(parsed.error).toMatch(/partial daily response.*precipitation=90/)
  })

  it("fails closed on missing/reordered dates, nulls, negatives, and malformed envelopes", () => {
    const wrongDate = completeResponse(window.windowEnd)
    wrongDate.daily!.time![10] = wrongDate.daily!.time![9]
    expect(historicalRainfallResponseToDataPoint(salyan, window, wrongDate).error).toMatch(/date mismatch/)

    const nullValue = completeResponse(window.windowEnd)
    nullValue.daily!.precipitation_sum![3] = null
    expect(historicalRainfallResponseToDataPoint(salyan, window, nullValue).error).toMatch(/invalid precipitation/)

    const negative = completeResponse(window.windowEnd)
    negative.daily!.precipitation_sum![4] = -0.1
    expect(historicalRainfallResponseToDataPoint(salyan, window, negative).error).toMatch(/invalid precipitation/)

    const missingUnit = completeResponse(window.windowEnd)
    delete missingUnit.daily_units
    expect(historicalRainfallResponseToDataPoint(salyan, window, missingUnit).error).toMatch(/unexpected precipitation unit/)

    const wrongUnit = completeResponse(window.windowEnd)
    wrongUnit.daily_units!.precipitation_sum = "inch"
    expect(historicalRainfallResponseToDataPoint(salyan, window, wrongUnit).error).toMatch(/unexpected precipitation unit/)

    expect(historicalRainfallResponseToDataPoint(salyan, window, {}).dataPoint).toBeNull()
  })
})

describe("Open-Meteo historical rainfall — adapter and ingest safety", () => {
  it("never calls or loads the supplied persistence seam in dry-run mode", async () => {
    const fetched = {
      source: "weather-openmeteo",
      dataPoints: [
        historicalRainfallResponseToDataPoint(
          WEATHER_REGIONS[0],
          buildLegacyRainfallWindow("2025-12-31"),
          completeResponse("2025-12-31"),
        ).dataPoint!,
      ],
      errors: [],
      fetched: true,
    }
    const adapter: CommodityAdapter = {
      source: "weather-openmeteo",
      label: "test",
      fetch: vi.fn(async () => fetched),
    }
    const persist = vi.fn(async () => ({ pointsWritten: 1, errors: [] }))
    const execution = await executeHistoricalRainfallBackfill({
      adapter,
      anchorDates: ["2025-12-31"],
      regionCodes: ["salyan"],
      apply: false,
      persist,
    })

    expect(execution.assessment.ok).toBe(true)
    expect(execution.writeAttempted).toBe(false)
    expect(execution.persistence).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })

  it("uses all canonical regions by default and fails the batch gate if one response is partial", async () => {
    let call = 0
    const fetchMock = vi.fn(async () => {
      call += 1
      const response = completeResponse("2025-12-31")
      if (call === 2) response.daily!.time = response.daily!.time!.slice(0, -1)
      return { ok: true, status: 200, json: async () => response } as Response
    })
    const anchors = ["2025-12-31"]
    const adapter = createOpenMeteoHistoricalRainfallAdapter({
      anchorDates: anchors,
      fetchImpl: fetchMock as typeof fetch,
    })
    const result = await adapter.fetch()
    const regionCodes = WEATHER_REGIONS.map((region) => region.code)
    const assessment = assessHistoricalRainfallBatch(result, anchors, regionCodes)

    expect(fetchMock).toHaveBeenCalledTimes(WEATHER_REGIONS.length)
    expect(result.dataPoints).toHaveLength(WEATHER_REGIONS.length - 1)
    expect(result.errors).toHaveLength(1)
    expect(assessment.ok).toBe(false)
    expect(assessment.expectedCount).toBe(WEATHER_REGIONS.length)
    expect(assessment.missingKeys).toHaveLength(1)
  })

  it("fetches twelve annual anchors with one union request per region", async () => {
    const anchors = buildMonthlyRainfallAnchors(2025)
    const range = buildHistoricalRainfallUnionRange(anchors)
    const fetchMock = vi.fn(async (_url: string | URL | Request) => ({
      ok: true,
      status: 200,
      json: async () => completeRangeResponse(range.windowStart, range.windowEnd, 2),
    } as Response))
    const adapter = createOpenMeteoHistoricalRainfallAdapter({
      anchorDates: anchors,
      regionCodes: ["salyan"],
      fetchImpl: fetchMock as typeof fetch,
    })
    const result = await adapter.fetch()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.errors).toEqual([])
    expect(result.dataPoints).toHaveLength(12)
    expect(result.dataPoints[0]).toMatchObject({
      metric: "SALYAN_RAINFALL_MM_90D",
      value: 182,
      raw: { windowStart: "2024-11-02", windowEnd: "2025-01-31", dayCount: 91 },
    })
    expect(result.dataPoints.at(-1)).toMatchObject({
      metric: "SALYAN_RAINFALL_MM_90D",
      value: 182,
      raw: { windowStart: "2025-10-02", windowEnd: "2025-12-31", dayCount: 91 },
    })
    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(calledUrl.searchParams.get("start_date")).toBe(range.windowStart)
    expect(calledUrl.searchParams.get("end_date")).toBe(range.windowEnd)
  })

  it("blocks every annual write when the union response is missing one day", async () => {
    const anchors = buildMonthlyRainfallAnchors(2025)
    const range = buildHistoricalRainfallUnionRange(anchors)
    const partial = completeRangeResponse(range.windowStart, range.windowEnd)
    partial.daily!.time!.splice(100, 1)
    partial.daily!.precipitation_sum!.splice(100, 1)
    const adapter = createOpenMeteoHistoricalRainfallAdapter({
      anchorDates: anchors,
      regionCodes: ["salyan"],
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => partial,
      } as Response)) as typeof fetch,
    })
    const persist = vi.fn(async () => ({ pointsWritten: 12, errors: [] }))
    const execution = await executeHistoricalRainfallBackfill({
      adapter,
      anchorDates: anchors,
      regionCodes: ["salyan"],
      apply: true,
      persist,
    })

    expect(execution.fetched.dataPoints).toHaveLength(0)
    expect(execution.assessment.ok).toBe(false)
    expect(execution.assessment.missingKeys).toHaveLength(12)
    expect(execution.writeAttempted).toBe(false)
    expect(persist).not.toHaveBeenCalled()
  })

  it("does not call persistence in apply mode when the upstream batch is partial", async () => {
    const partialAdapter: CommodityAdapter = {
      source: "weather-openmeteo",
      label: "partial",
      fetch: vi.fn(async () => ({
        source: "weather-openmeteo",
        dataPoints: [],
        errors: ["salyan@2025-12-31: partial daily response"],
        fetched: true,
      })),
    }
    const persist = vi.fn(async () => ({ pointsWritten: 0, errors: [] }))
    const execution = await executeHistoricalRainfallBackfill({
      adapter: partialAdapter,
      anchorDates: ["2025-12-31"],
      regionCodes: ["salyan"],
      apply: true,
      persist,
    })

    expect(execution.assessment.ok).toBe(false)
    expect(execution.writeAttempted).toBe(false)
    expect(persist).not.toHaveBeenCalled()
  })

  it("surfaces HTTP, network, and JSON errors without producing a point", async () => {
    const cases: Array<{ response: () => Promise<Response>; pattern: RegExp }> = [
      {
        response: async () => ({ ok: false, status: 503 } as Response),
        pattern: /HTTP 503/,
      },
      {
        response: async () => { throw new Error("ENETUNREACH") },
        pattern: /fetch failed.*ENETUNREACH/,
      },
      {
        response: async () => ({
          ok: true,
          status: 200,
          json: async () => { throw new Error("bad json") },
        } as unknown as Response),
        pattern: /JSON parse failed.*bad json/,
      },
    ]
    for (const testCase of cases) {
      const adapter = createOpenMeteoHistoricalRainfallAdapter({
        anchorDates: ["2025-12-31"],
        regionCodes: ["salyan"],
        fetchImpl: vi.fn(testCase.response) as unknown as typeof fetch,
      })
      const result = await adapter.fetch()
      expect(result.dataPoints).toHaveLength(0)
      expect(result.errors[0]).toMatch(testCase.pattern)
    }
  })

  it("aborts a stalled Archive request at the injected timeout", async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted by timeout")))
      }),
    )
    const adapter = createOpenMeteoHistoricalRainfallAdapter({
      anchorDates: ["2025-12-31"],
      regionCodes: ["salyan"],
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 10,
    })
    const result = await adapter.fetch()

    expect(result.dataPoints).toHaveLength(0)
    expect(result.errors[0]).toMatch(/fetch failed.*aborted by timeout/)
  })

  it("re-running the same canonical point uses the same existing Prisma upsert key", async () => {
    const adapter = createOpenMeteoHistoricalRainfallAdapter({
      anchorDates: ["2025-12-31"],
      regionCodes: ["salyan"],
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => completeResponse("2025-12-31", 1.5),
      } as Response)) as typeof fetch,
    })
    const fetched = await adapter.fetch()
    expect(assessHistoricalRainfallBatch(fetched, ["2025-12-31"], ["salyan"]).ok).toBe(true)
    const frozen: CommodityAdapter = {
      source: adapter.source,
      label: adapter.label,
      fetch: async () => fetched,
    }

    const upsert = vi.fn(async (_args: unknown) => ({}))
    const prisma = {
      intelDataPoint: { upsert },
    } as unknown as PrismaClient

    await ingestCommodityData("org_weather", [frozen], { prisma })
    await ingestCommodityData("org_weather", [frozen], { prisma })

    expect(upsert).toHaveBeenCalledTimes(2)
    type UpsertArgs = {
      where: {
        organizationId_sourceCode_metric_datetime: {
          organizationId: string
          sourceCode: string
          metric: string
          datetime: Date
        }
      }
    }
    const firstArgs = upsert.mock.calls[0]?.[0] as UpsertArgs | undefined
    const secondArgs = upsert.mock.calls[1]?.[0] as UpsertArgs | undefined
    expect(firstArgs).toBeDefined()
    expect(secondArgs).toBeDefined()
    const firstKey = firstArgs!.where.organizationId_sourceCode_metric_datetime
    const secondKey = secondArgs!.where.organizationId_sourceCode_metric_datetime
    expect(secondKey).toEqual(firstKey)
    expect(firstKey).toEqual({
      organizationId: "org_weather",
      sourceCode: "weather-openmeteo",
      metric: "SALYAN_RAINFALL_MM_90D",
      datetime: new Date("2025-12-31T00:00:00.000Z"),
    })
    expect(getCommodityMemorySize()).toBe(1)
    const stored = getInMemoryDataPoints("org_weather", "weather-openmeteo")
    expect(stored).toHaveLength(1)
    expect(stored[0].datetime.toISOString()).toBe("2025-12-31T00:00:00.000Z")
    expect(stored[0].raw).toMatchObject({ dayCount: 91, windowEnd: "2025-12-31" })
  })
})
