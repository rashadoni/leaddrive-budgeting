/**
 * Phase 7.I — Open-Meteo weather adapter for the Azerbaijani sugar belt.
 *
 * Pulls trailing-90-day rainfall + temperature for fixed regions where
 * Azərşəkər's cane growing operations sit (EDEN + FARM in Salyan;
 * AZSF + CPC drawing cane from Imishli/Sabirabad). Emits one
 * `RAINFALL_MM_90D` + one `TEMP_AVG_C_30D` data point per region per run.
 *
 * **Source:** open-meteo.com — free, no key, no rate-limit for low volume.
 * `https://archive-api.open-meteo.com/v1/archive` for past 90 days
 * (precipitation_sum, temperature_2m_mean daily series).
 *
 * **Per-region (NOT per-company):** the adapter ingests ONE point per
 * `(region, metric, today UTC)`. The recompute resolver later maps
 * `company.settings.region` → the matching ingest row. Adding new regions
 * = edit `WEATHER_REGIONS` const; no code change needed for new companies.
 *
 * **Cadence:** daily via the existing intel scheduler (24h interval).
 * Idempotent: re-run on the same UTC day re-writes the same row via the
 * `(orgId, sourceCode, metric, datetime)` unique constraint.
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"

const WEATHER_SOURCE = "weather-openmeteo"
const WEATHER_LABEL = "Open-Meteo Weather (AZ sugar belt)"

/**
 * Azerbaijani farming regions for Azərşəkər operations with representative
 * coordinates. Centroid of the agricultural area, not the city centre —
 * irrigated fields sit south of Salyan town, west of Imishli town, around
 * Sabirabad town, etc.
 *
 * Region inventory grew from the original 3 (Salyan/Imishli/Sabirabad — sugar
 * belt) to 8 after Session 9 audit of `Copy of Guvven Fin.xlsx`'s Farming KPI
 * sheet revealed AZSEKER-EDEN + AZSEKER-FARM also operate in Yevlax, Şəmkir,
 * Füzuli, Ağcabədi, and Beyləqan farms (Qarabağ Taxıl cost center).
 *
 * Crops by region (per Farming KPI 2026):
 *   Salyan / Imishli / Sabirabad → sugar beet (Şəkər Çuğunduru) — original 3
 *   Yevlax / Şəmkir              → wheat (Buğda), barley (Arpa), cotton, corn
 *   Füzuli                       → wheat, barley, corn, cotton, sugar beet
 *   Ağcabədi                     → corn, wheat, sugar beet
 *   Beyləqan (Qarabağ Taxıl)     → wheat, barley, corn
 *
 * Adding a region = append a row + ship the seed-side `region` enum that
 * `company.settings.region` accepts. No adapter code change needed.
 */
export const WEATHER_REGIONS = [
  { code: "salyan", latitude: 39.5, longitude: 48.95, label: "Salyan" },
  { code: "imishli", latitude: 39.85, longitude: 48.05, label: "İmişli" },
  { code: "sabirabad", latitude: 39.97, longitude: 48.43, label: "Sabirabad" },
  // Session 9 additions — central + western Azerbaijan farming.
  { code: "yevlax", latitude: 40.62, longitude: 47.15, label: "Yevlax" },
  { code: "shamkir", latitude: 40.83, longitude: 46.01, label: "Şəmkir" },
  { code: "fuzuli", latitude: 39.60, longitude: 47.14, label: "Füzuli" },
  { code: "agjabedi", latitude: 40.04, longitude: 47.46, label: "Ağcabədi" },
  { code: "beylaqan", latitude: 39.77, longitude: 47.62, label: "Beyləqan" },
] as const

export type WeatherRegionCode = (typeof WEATHER_REGIONS)[number]["code"]

const OPEN_METEO_BASE_URL = "https://archive-api.open-meteo.com/v1/archive"

interface OpenMeteoArchiveResponse {
  latitude?: number
  longitude?: number
  daily?: {
    time?: string[]
    precipitation_sum?: number[]
    temperature_2m_mean?: number[]
  }
}

/**
 * Convert one region's parsed Open-Meteo response into normalized data
 * points. Pure helper so tests can feed canned JSON without HTTP.
 *
 * Emits two points per region:
 *  - `<region>_RAINFALL_MM_90D` — sum of 90 daily precipitation values
 *  - `<region>_TEMP_AVG_C_30D` — mean of last 30 daily temperature values
 *
 * Datetime anchored to today UTC midnight for idempotency under daily
 * re-runs.
 */
export function openMeteoResponseToDataPoints(
  regionCode: WeatherRegionCode,
  response: OpenMeteoArchiveResponse,
  now: Date = new Date(),
): CommodityDataPoint[] {
  const daily = response.daily
  if (!daily || !Array.isArray(daily.time)) return []
  const precipSeries = daily.precipitation_sum ?? []
  const tempSeries = daily.temperature_2m_mean ?? []
  const datetime = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )

  const points: CommodityDataPoint[] = []

  if (precipSeries.length > 0) {
    const rainfall90d = precipSeries
      .filter((v) => typeof v === "number" && Number.isFinite(v))
      .reduce((s, v) => s + v, 0)
    points.push({
      sourceCode: WEATHER_SOURCE,
      metric: `${regionCode.toUpperCase()}_RAINFALL_MM_90D`,
      datetime,
      value: Math.round(rainfall90d * 10) / 10, // 1 decimal
      unit: "mm",
      raw: { samples: precipSeries.length, source: "open-meteo archive" },
    })
  }

  if (tempSeries.length > 0) {
    const last30 = tempSeries
      .slice(-30)
      .filter((v) => typeof v === "number" && Number.isFinite(v))
    if (last30.length > 0) {
      const tempAvg30d = last30.reduce((s, v) => s + v, 0) / last30.length
      points.push({
        sourceCode: WEATHER_SOURCE,
        metric: `${regionCode.toUpperCase()}_TEMP_AVG_C_30D`,
        datetime,
        value: Math.round(tempAvg30d * 10) / 10,
        unit: "°C",
        raw: { samples: last30.length, source: "open-meteo archive" },
      })
    }
  }

  return points
}

/**
 * Format the 90-day-back date range Open-Meteo expects. YYYY-MM-DD.
 * Pure helper so tests can lock the exact URL shape under a fake clock.
 */
export function openMeteoDateRange(
  now: Date = new Date(),
): { startDate: string; endDate: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  // Open-Meteo archive lags ~5 days behind real-time. End at today-5 to
  // avoid the rolling "data not yet available" zone at the leading edge.
  end.setUTCDate(end.getUTCDate() - 5)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 90)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { startDate: fmt(start), endDate: fmt(end) }
}

export function createOpenMeteoWeatherAdapter(
  opts: CommodityAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: WEATHER_SOURCE,
    label: WEATHER_LABEL,
    async fetch(now: Date = new Date()): Promise<CommodityFetchResult> {
      const { startDate, endDate } = openMeteoDateRange(now)
      const errors: string[] = []
      const allPoints: CommodityDataPoint[] = []

      for (const region of WEATHER_REGIONS) {
        const url =
          `${OPEN_METEO_BASE_URL}?latitude=${region.latitude}&longitude=${region.longitude}` +
          `&start_date=${startDate}&end_date=${endDate}` +
          `&daily=precipitation_sum,temperature_2m_mean&timezone=UTC`
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
          errors.push(`${region.code}: HTTP ${response.status} from ${url}`)
          continue
        }
        let parsed: OpenMeteoArchiveResponse
        try {
          parsed = (await response.json()) as OpenMeteoArchiveResponse
        } catch (e) {
          errors.push(
            `${region.code}: JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        const points = openMeteoResponseToDataPoints(region.code, parsed, now)
        if (points.length === 0) {
          errors.push(
            `${region.code}: response had no usable daily series (got: ${JSON.stringify(parsed.daily ?? null).slice(0, 100)})`,
          )
        }
        allPoints.push(...points)
      }

      return {
        source: WEATHER_SOURCE,
        dataPoints: allPoints,
        errors,
        fetched: true,
      }
    },
  }
}

export const WEATHER_OPENMETEO_SOURCE = WEATHER_SOURCE
