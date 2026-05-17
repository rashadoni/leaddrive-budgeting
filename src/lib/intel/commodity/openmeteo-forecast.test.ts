/**
 * Tests for the Open-Meteo 14-day forecast adapter.
 *
 * Covers:
 *  - 3 metrics per region (rainfall sum + mean temp + max temp)
 *  - Idempotency: today UTC midnight anchor
 *  - Per-region error isolation
 *  - Pure helper math
 */
import { describe, it, expect, vi } from "vitest"
import {
  openMeteoForecastToDataPoints,
  createOpenMeteoForecastAdapter,
  OPENMETEO_FORECAST_SOURCE,
} from "./openmeteo-forecast"
import { WEATHER_REGIONS } from "./weather-openmeteo"

function makeForecastResponse(opts: {
  precip?: number[]
  meanT?: number[]
  maxT?: number[]
}) {
  return {
    daily: {
      time: (opts.precip ?? opts.meanT ?? opts.maxT ?? []).map(
        (_, i) => `2026-05-${String(17 + i).padStart(2, "0")}`,
      ),
      precipitation_sum: opts.precip,
      temperature_2m_mean: opts.meanT,
      temperature_2m_max: opts.maxT,
    },
  }
}

describe("openMeteoForecastToDataPoints", () => {
  it("emits 3 points per region with valid daily series", () => {
    const points = openMeteoForecastToDataPoints(
      "salyan",
      makeForecastResponse({
        precip: [1, 2, 3, 0, 0, 1, 2, 0, 5, 1, 0, 3, 1, 0],
        meanT: [22, 23, 24, 22, 21, 23, 25, 24, 23, 22, 21, 22, 23, 24],
        maxT: [28, 29, 31, 28, 27, 29, 32, 31, 28, 27, 26, 27, 29, 30],
      }),
      new Date("2026-05-17T12:00:00Z"),
    )
    expect(points.length).toBe(3)
    const byMetric = Object.fromEntries(points.map((p) => [p.metric, p]))
    expect(byMetric["SALYAN_RAINFALL_MM_14D_FCST"].value).toBe(19)
    expect(byMetric["SALYAN_TEMP_AVG_C_14D_FCST"].value).toBeCloseTo(22.8, 1)
    expect(byMetric["SALYAN_TEMP_MAX_C_14D_FCST"].value).toBe(32)
  })

  it("anchors datetime to today UTC midnight", () => {
    const points = openMeteoForecastToDataPoints(
      "salyan",
      makeForecastResponse({ precip: [1, 2, 3] }),
      new Date("2026-05-17T15:30:45Z"),
    )
    expect(points[0].datetime.toISOString()).toBe("2026-05-17T00:00:00.000Z")
  })

  it("skips a metric whose series is empty/missing", () => {
    const points = openMeteoForecastToDataPoints(
      "salyan",
      makeForecastResponse({ precip: [1, 2] }), // no temp series
    )
    expect(points.length).toBe(1)
    expect(points[0].metric).toBe("SALYAN_RAINFALL_MM_14D_FCST")
  })

  it("returns [] when daily envelope is absent", () => {
    expect(openMeteoForecastToDataPoints("salyan", {})).toEqual([])
  })

  it("trims at 14 days even if more provided", () => {
    const longSeries = Array.from({ length: 20 }, (_, i) => i + 1)
    const points = openMeteoForecastToDataPoints(
      "salyan",
      makeForecastResponse({ precip: longSeries }),
    )
    // 1+2+...+14 = 105
    expect(points[0].value).toBe(105)
  })
})

describe("createOpenMeteoForecastAdapter", () => {
  it("returns adapter with correct contract", () => {
    const adapter = createOpenMeteoForecastAdapter()
    expect(adapter.source).toBe(OPENMETEO_FORECAST_SOURCE)
    expect(adapter.label).toContain("Forecast")
  })

  it("fetches all 8 regions × 3 metrics", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            makeForecastResponse({
              precip: Array(14).fill(2),
              meanT: Array(14).fill(20),
              maxT: Array(14).fill(28),
            }),
          ),
          { status: 200 },
        ),
    )
    const adapter = createOpenMeteoForecastAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.fetched).toBe(true)
    // 8 regions × 3 metrics
    expect(result.dataPoints.length).toBe(WEATHER_REGIONS.length * 3)
    expect(result.errors).toEqual([])
  })

  it("isolates per-region HTTP errors", async () => {
    let call = 0
    const fetchImpl = vi.fn(async () => {
      call++
      if (call === 1) return new Response("bad", { status: 500 })
      return new Response(
        JSON.stringify(makeForecastResponse({ precip: [1, 2, 3] })),
        { status: 200 },
      )
    })
    const adapter = createOpenMeteoForecastAdapter({ fetchImpl: fetchImpl as never })
    const result = await adapter.fetch()
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain("HTTP 500")
    // 7 regions × 1 metric (only precip provided) = 7 points
    expect(result.dataPoints.length).toBe((WEATHER_REGIONS.length - 1) * 1)
  })

  it("requests forecast_days=14 in URL", async () => {
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify(makeForecastResponse({ precip: [1, 2, 3] })),
          { status: 200 },
        ),
    )
    const adapter = createOpenMeteoForecastAdapter({ fetchImpl: fetchImpl as never })
    await adapter.fetch()
    const url = fetchImpl.mock.calls[0]?.[0] ?? ""
    expect(url).toContain("forecast_days=14")
    expect(url).toContain("temperature_2m_max")
  })
})
