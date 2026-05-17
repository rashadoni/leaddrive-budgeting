/**
 * Phase 7.K — Open-Meteo 14-day forecast adapter.
 *
 * Companion to `weather-openmeteo.ts` (historical archive). This adapter
 * pulls **forward-looking** 14-day forecasts for the same 8 AZ regions
 * so non-agro sectors can react to upcoming weather:
 *
 *  - **agro_crops**: predicted rainfall → irrigation scheduling, harvest
 *    timing
 *  - **hospitality**: temp + clear-sky forecast → hotel occupancy / pool
 *    open / beach demand
 *  - **entertainment**: outdoor venue demand (rain risk on event days)
 *  - **logistics**: extreme weather alerts (heat / freeze) → fleet
 *    routing decisions
 *
 * **Source**: open-meteo.com `/v1/forecast` — free, no key, returns
 * 7-16 days of daily forecast. We request 14d.
 *
 * **Metrics emitted per region**:
 *   <REGION>_RAINFALL_MM_14D_FCST — sum of 14 daily precip values
 *   <REGION>_TEMP_AVG_C_14D_FCST  — mean of 14 daily temperature_2m_mean
 *   <REGION>_TEMP_MAX_C_14D_FCST  — max of 14 daily temperature_2m_max
 *                                    (heatwave indicator for outdoor
 *                                     venues + logistics fleet)
 *
 * **Cadence**: daily — same as the archive adapter. Idempotent via
 * `(orgId, source, metric, datetime=today UTC)` unique constraint.
 *
 * **Idempotency**: anchored to today UTC midnight so the 14d forecast
 * issued on a given UTC date overwrites itself on re-run, never
 * accumulates duplicates.
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"
import { WEATHER_REGIONS, type WeatherRegionCode } from "./weather-openmeteo"

const FORECAST_SOURCE = "openmeteo-forecast"
const FORECAST_LABEL = "Open-Meteo Forecast (AZ 14d outlook)"

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

interface OpenMeteoForecastResponse {
  daily?: {
    time?: string[]
    precipitation_sum?: number[]
    temperature_2m_mean?: number[]
    temperature_2m_max?: number[]
  }
}

/**
 * Pure helper: pick last 14 valid numeric values from a daily series.
 * If fewer than 14 days exist (e.g. forecast was capped), uses what's
 * available — empty-result handling is up to the caller.
 */
function clean14(series: number[] | undefined, days = 14): number[] {
  if (!Array.isArray(series)) return []
  return series
    .slice(0, days)
    .filter((v) => typeof v === "number" && Number.isFinite(v))
}

/**
 * Convert one region's parsed forecast response → 3 normalized data
 * points (rainfall sum, mean temp, max temp). Pure helper for tests.
 */
export function openMeteoForecastToDataPoints(
  regionCode: WeatherRegionCode,
  response: OpenMeteoForecastResponse,
  now: Date = new Date(),
): CommodityDataPoint[] {
  const daily = response.daily
  if (!daily) return []
  const datetime = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  const points: CommodityDataPoint[] = []
  const REGION_UPPER = regionCode.toUpperCase()

  const precip = clean14(daily.precipitation_sum)
  if (precip.length > 0) {
    const sum = precip.reduce((s, v) => s + v, 0)
    points.push({
      sourceCode: FORECAST_SOURCE,
      metric: `${REGION_UPPER}_RAINFALL_MM_14D_FCST`,
      datetime,
      value: Math.round(sum * 10) / 10,
      unit: "mm",
      raw: { samples: precip.length, source: "open-meteo forecast" },
    })
  }

  const tempMean = clean14(daily.temperature_2m_mean)
  if (tempMean.length > 0) {
    const avg = tempMean.reduce((s, v) => s + v, 0) / tempMean.length
    points.push({
      sourceCode: FORECAST_SOURCE,
      metric: `${REGION_UPPER}_TEMP_AVG_C_14D_FCST`,
      datetime,
      value: Math.round(avg * 10) / 10,
      unit: "°C",
      raw: { samples: tempMean.length, source: "open-meteo forecast" },
    })
  }

  const tempMax = clean14(daily.temperature_2m_max)
  if (tempMax.length > 0) {
    const max = Math.max(...tempMax)
    points.push({
      sourceCode: FORECAST_SOURCE,
      metric: `${REGION_UPPER}_TEMP_MAX_C_14D_FCST`,
      datetime,
      value: Math.round(max * 10) / 10,
      unit: "°C",
      raw: { samples: tempMax.length, source: "open-meteo forecast" },
    })
  }

  return points
}

export function createOpenMeteoForecastAdapter(
  opts: CommodityAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: FORECAST_SOURCE,
    label: FORECAST_LABEL,
    async fetch(now: Date = new Date()): Promise<CommodityFetchResult> {
      const errors: string[] = []
      const allPoints: CommodityDataPoint[] = []
      for (const region of WEATHER_REGIONS) {
        const url =
          `${OPEN_METEO_FORECAST_URL}?latitude=${region.latitude}` +
          `&longitude=${region.longitude}` +
          `&daily=precipitation_sum,temperature_2m_mean,temperature_2m_max` +
          `&forecast_days=14&timezone=UTC`
        let response: Response
        try {
          response = await fetchImpl(url)
        } catch (e) {
          errors.push(
            `${region.code}: fetch failed: ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        if (!response.ok) {
          errors.push(`${region.code}: HTTP ${response.status} from forecast endpoint`)
          continue
        }
        let parsed: OpenMeteoForecastResponse
        try {
          parsed = (await response.json()) as OpenMeteoForecastResponse
        } catch (e) {
          errors.push(
            `${region.code}: JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        const points = openMeteoForecastToDataPoints(region.code, parsed, now)
        if (points.length === 0) {
          errors.push(
            `${region.code}: forecast had no usable daily series (got: ${JSON.stringify(parsed.daily ?? null).slice(0, 100)})`,
          )
        }
        allPoints.push(...points)
      }
      return {
        source: FORECAST_SOURCE,
        dataPoints: allPoints,
        errors,
        fetched: true,
      }
    },
  }
}

export const OPENMETEO_FORECAST_SOURCE = FORECAST_SOURCE
