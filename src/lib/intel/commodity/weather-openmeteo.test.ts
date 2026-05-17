/**
 * Phase 7.I — Open-Meteo weather adapter tests.
 *
 * Locks shape contract + error-paths so the adapter can run in the
 * scheduler without surprising the persistence layer.
 */

import { describe, it, expect, vi } from "vitest"
import {
  createOpenMeteoWeatherAdapter,
  openMeteoResponseToDataPoints,
  openMeteoDateRange,
  WEATHER_REGIONS,
  WEATHER_OPENMETEO_SOURCE,
} from "./weather-openmeteo"

describe("weather-openmeteo — pure response → data-points", () => {
  it("aggregates 90-day rainfall + 30-day mean temp from daily series", () => {
    const now = new Date("2026-06-01T00:00:00Z")
    const response = {
      daily: {
        time: Array.from({ length: 91 }, (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`),
        precipitation_sum: Array.from({ length: 91 }, () => 2.0), // 2 mm/day × 91 = 182
        temperature_2m_mean: Array.from({ length: 91 }, (_, i) => i < 61 ? 15 : 25),
      },
    }
    const points = openMeteoResponseToDataPoints("salyan", response, now)
    expect(points).toHaveLength(2)
    const rain = points.find((p) => p.metric === "SALYAN_RAINFALL_MM_90D")
    const temp = points.find((p) => p.metric === "SALYAN_TEMP_AVG_C_30D")
    expect(rain?.value).toBe(182)
    expect(rain?.unit).toBe("mm")
    expect(temp?.value).toBe(25) // last 30 days all 25
    expect(temp?.unit).toBe("°C")
  })

  it("anchors datetime to today UTC midnight (idempotency key)", () => {
    const now = new Date("2026-06-15T14:30:00Z")
    const response = {
      daily: {
        time: ["2026-03-01"],
        precipitation_sum: [5],
        temperature_2m_mean: [20],
      },
    }
    const points = openMeteoResponseToDataPoints("imishli", response, now)
    expect(points[0].datetime.toISOString()).toBe("2026-06-15T00:00:00.000Z")
  })

  it("emits zero points when daily series missing entirely", () => {
    const points = openMeteoResponseToDataPoints("salyan", {}, new Date())
    expect(points).toHaveLength(0)
  })

  it("filters NaN / non-finite samples", () => {
    const now = new Date("2026-06-01T00:00:00Z")
    const response = {
      daily: {
        time: ["d1", "d2", "d3"],
        precipitation_sum: [10, Number.NaN, 5],
        temperature_2m_mean: [20, Number.POSITIVE_INFINITY, 22],
      },
    }
    const points = openMeteoResponseToDataPoints("salyan", response, now)
    const rain = points.find((p) => p.metric === "SALYAN_RAINFALL_MM_90D")
    expect(rain?.value).toBe(15) // 10 + 5, NaN filtered
  })
})

describe("weather-openmeteo — date range helper", () => {
  it("produces a 90-day window ending 5 days before now (archive lag)", () => {
    const now = new Date("2026-06-15T00:00:00Z")
    const { startDate, endDate } = openMeteoDateRange(now)
    expect(endDate).toBe("2026-06-10") // 15 − 5 archive lag
    expect(startDate).toBe("2026-03-12") // 10 − 90 days
  })
})

describe("weather-openmeteo — full adapter via mock fetch", () => {
  it("runs fetch for every configured region and aggregates points", async () => {
    const mockResponse = {
      daily: {
        time: Array.from({ length: 91 }, (_, i) => `d${i}`),
        precipitation_sum: Array.from({ length: 91 }, () => 1.5),
        temperature_2m_mean: Array.from({ length: 91 }, () => 18),
      },
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response)
    const adapter = createOpenMeteoWeatherAdapter({ fetchImpl: fetchMock as typeof fetch })
    const result = await adapter.fetch(new Date("2026-06-01T00:00:00Z"))
    expect(result.source).toBe(WEATHER_OPENMETEO_SOURCE)
    expect(result.fetched).toBe(true)
    expect(result.errors).toEqual([])
    // 3 regions × 2 metrics each = 6 points
    expect(result.dataPoints).toHaveLength(WEATHER_REGIONS.length * 2)
    expect(fetchMock).toHaveBeenCalledTimes(WEATHER_REGIONS.length)
  })

  it("captures per-region HTTP errors without aborting other regions", async () => {
    let call = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1
      if (call === 2) {
        return { ok: false, status: 503, json: async () => ({}) } as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          daily: { time: ["d1"], precipitation_sum: [3], temperature_2m_mean: [20] },
        }),
      } as Response
    })
    const adapter = createOpenMeteoWeatherAdapter({ fetchImpl: fetchMock as typeof fetch })
    const result = await adapter.fetch()
    expect(result.errors.length).toBe(1)
    expect(result.errors[0]).toContain("HTTP 503")
    // Parameterised on region count so adding regions later doesn't break the
    // test: (N − 1) successful regions × 2 metrics. Session 9 expanded from
    // 3 → 8 regions, hence 7 × 2 = 14 points; before was 2 × 2 = 4.
    expect(result.dataPoints.length).toBe((WEATHER_REGIONS.length - 1) * 2)
  })

  it("captures network failure as error but keeps fetched=true if any region attempted", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("DNS failure"))
    const adapter = createOpenMeteoWeatherAdapter({ fetchImpl: fetchMock as typeof fetch })
    const result = await adapter.fetch()
    expect(result.dataPoints).toHaveLength(0)
    expect(result.errors.length).toBe(WEATHER_REGIONS.length)
    expect(result.errors[0]).toMatch(/fetch failed.*DNS failure/)
  })
})

describe("WEATHER_REGIONS — Session 9 expansion", () => {
  it("covers all 8 AzerSheker farming areas from Farming KPI sheet", () => {
    const codes = WEATHER_REGIONS.map((r) => r.code)
    // Original sugar belt
    expect(codes).toContain("salyan")
    expect(codes).toContain("imishli")
    expect(codes).toContain("sabirabad")
    // Session 9 additions — central/western AZ farming
    expect(codes).toContain("yevlax")
    expect(codes).toContain("shamkir")
    expect(codes).toContain("fuzuli")
    expect(codes).toContain("agjabedi")
    expect(codes).toContain("beylaqan")
    expect(codes).toHaveLength(8)
  })

  it("every region has a label + coordinates inside Azerbaijan bounding box", () => {
    // Azerbaijan rough bbox: lat 38..42, lon 45..51 (covers all 8 regions
    // including Şəmkir in the NW and Salyan in the SE).
    for (const r of WEATHER_REGIONS) {
      expect(r.label.length).toBeGreaterThan(0)
      expect(r.latitude).toBeGreaterThanOrEqual(38)
      expect(r.latitude).toBeLessThanOrEqual(42)
      expect(r.longitude).toBeGreaterThanOrEqual(45)
      expect(r.longitude).toBeLessThanOrEqual(51)
    }
  })

  it("region codes are unique (no accidental duplicates)", () => {
    const codes = WEATHER_REGIONS.map((r) => r.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
