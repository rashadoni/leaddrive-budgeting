/**
 * Track 1.1C — period-bounded Open-Meteo Archive rainfall backfill.
 *
 * This is deliberately separate from the scheduled weather adapter. The
 * scheduled adapter answers "what is the latest snapshot?" while this module
 * reconstructs explicitly requested historical snapshots without consulting
 * the wall clock or inventing missing days.
 *
 * `RAINFALL_MM_90D` is a legacy metric name. Its established calculation is
 * an inclusive 91-calendar-day window: `windowStart = windowEnd - 90 days`,
 * then sum every day from start through end. The raw evidence written with
 * each point makes that off-by-one-looking contract explicit. Annual mode
 * fetches one validated union range per region and slices the twelve exact
 * windows locally, so eight configured regions mean eight HTTP requests.
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"
import {
  WEATHER_OPENMETEO_SOURCE,
  WEATHER_REGIONS,
  type WeatherRegionCode,
} from "./weather-openmeteo"

const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
export const LEGACY_RAINFALL_DAY_COUNT = 91

export interface LegacyRainfallWindow {
  /** Inclusive ISO UTC date. */
  windowStart: string
  /** Inclusive ISO UTC date and canonical IntelDataPoint observation date. */
  windowEnd: string
  dayCount: typeof LEGACY_RAINFALL_DAY_COUNT
}

export interface OpenMeteoHistoricalRainfallResponse {
  latitude?: number
  longitude?: number
  daily_units?: {
    precipitation_sum?: string
  }
  daily?: {
    time?: string[]
    precipitation_sum?: Array<number | null>
  }
}

export interface HistoricalRainfallAdapterOptions extends CommodityAdapterOptions {
  /** Historical snapshot dates. Each becomes one canonical UTC-midnight row. */
  anchorDates: readonly string[]
  /** Defaults to every canonical region in WEATHER_REGIONS. */
  regionCodes?: readonly WeatherRegionCode[]
  /** Per-region Archive request timeout. Defaults to 15 seconds. */
  timeoutMs?: number
}

export interface HistoricalRainfallParseResult {
  dataPoint: CommodityDataPoint | null
  error: string | null
}

export interface HistoricalRainfallBatchAssessment {
  ok: boolean
  expectedCount: number
  actualCount: number
  missingKeys: string[]
  unexpectedKeys: string[]
  duplicateKeys: string[]
  upstreamErrors: string[]
}

export interface HistoricalRainfallPersistenceResult {
  pointsWritten: number
  errors: string[]
}

export interface HistoricalRainfallExecutionResult {
  fetched: CommodityFetchResult
  assessment: HistoricalRainfallBatchAssessment
  writeAttempted: boolean
  persistence: HistoricalRainfallPersistenceResult | null
}

export interface HistoricalRainfallUnionRange {
  /** Inclusive ISO UTC date. */
  windowStart: string
  /** Inclusive ISO UTC date. */
  windowEnd: string
  dayCount: number
}

function parseIsoUtcDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ISO date: ${value}`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date: ${value}`)
  }
  return parsed
}

function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function inclusiveDayCount(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
}

/** Build the exact legacy inclusive window for one historical observation. */
export function buildLegacyRainfallWindow(windowEnd: string): LegacyRainfallWindow {
  const end = parseIsoUtcDate(windowEnd)
  return {
    windowStart: formatIsoDate(addUtcDays(end, -(LEGACY_RAINFALL_DAY_COUNT - 1))),
    windowEnd,
    dayCount: LEGACY_RAINFALL_DAY_COUNT,
  }
}

/**
 * Month-end historical anchors for a calendar year. February naturally uses
 * 28 or 29 through UTC date arithmetic; no locale or server timezone enters
 * the calculation.
 */
export function buildMonthlyRainfallAnchors(year: number): string[] {
  if (!Number.isInteger(year) || year < 1940 || year > 2100) {
    throw new Error(`Historical rainfall year must be an integer in 1940..2100 (got ${year})`)
  }
  return Array.from({ length: 12 }, (_, month) =>
    formatIsoDate(new Date(Date.UTC(year, month + 1, 0))),
  )
}

/** One union query range covering every overlapping 91-day anchor window. */
export function buildHistoricalRainfallUnionRange(
  anchorDates: readonly string[],
): HistoricalRainfallUnionRange {
  if (anchorDates.length === 0) throw new Error("At least one historical rainfall anchor is required")
  const windows = [...new Set(anchorDates)].map(buildLegacyRainfallWindow)
  const windowStart = windows.map((window) => window.windowStart).sort()[0]
  const windowEnd = windows.map((window) => window.windowEnd).sort().at(-1)
  if (!windowStart || !windowEnd) throw new Error("Could not derive historical rainfall union range")
  return {
    windowStart,
    windowEnd,
    dayCount: inclusiveDayCount(parseIsoUtcDate(windowStart), parseIsoUtcDate(windowEnd)),
  }
}

export function buildHistoricalRainfallUrl(
  region: (typeof WEATHER_REGIONS)[number],
  window: Pick<LegacyRainfallWindow, "windowStart" | "windowEnd">,
): string {
  const url = new URL(OPEN_METEO_ARCHIVE_URL)
  url.searchParams.set("latitude", String(region.latitude))
  url.searchParams.set("longitude", String(region.longitude))
  url.searchParams.set("start_date", window.windowStart)
  url.searchParams.set("end_date", window.windowEnd)
  url.searchParams.set("daily", "precipitation_sum")
  url.searchParams.set("timezone", "UTC")
  return url.toString()
}

function validateHistoricalDailySeries(
  range: HistoricalRainfallUnionRange,
  response: OpenMeteoHistoricalRainfallResponse,
): { times: string[]; precipitation: number[]; error: null } | { error: string } {
  const times = response.daily?.time
  const precipitation = response.daily?.precipitation_sum
  if (!Array.isArray(times) || !Array.isArray(precipitation)) {
    return { error: "missing daily.time or daily.precipitation_sum" }
  }
  // The point is labelled `mm`; accepting an absent unit would silently turn
  // an untyped provider value into a measurement we cannot substantiate.
  if (response.daily_units?.precipitation_sum !== "mm") {
    return { error: `unexpected precipitation unit: ${String(response.daily_units?.precipitation_sum)}` }
  }
  if (times.length !== range.dayCount || precipitation.length !== range.dayCount) {
    return {
      error: `partial daily response: expected ${range.dayCount}, got time=${times.length}, precipitation=${precipitation.length}`,
    }
  }
  const start = parseIsoUtcDate(range.windowStart)
  const normalized: number[] = []
  for (let index = 0; index < range.dayCount; index += 1) {
    const expectedDate = formatIsoDate(addUtcDays(start, index))
    if (times[index] !== expectedDate) {
      return {
        error: `daily date mismatch at index ${index}: expected ${expectedDate}, got ${String(times[index])}`,
      }
    }
    const value = precipitation[index]
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { error: `invalid precipitation at ${expectedDate}: ${String(value)}` }
    }
    normalized.push(value)
  }
  return { times, precipitation: normalized, error: null }
}

/**
 * Parse one region/window response. Any missing, duplicate, reordered,
 * non-finite, null, negative, or wrong-unit daily value invalidates the whole
 * snapshot. A partial 90/91 response is absence, never a fabricated zero.
 */
export function historicalRainfallResponseToDataPoint(
  region: (typeof WEATHER_REGIONS)[number],
  window: LegacyRainfallWindow,
  response: OpenMeteoHistoricalRainfallResponse,
): HistoricalRainfallParseResult {
  const validated = validateHistoricalDailySeries(window, response)
  if (validated.error !== null) return { dataPoint: null, error: validated.error }
  const rainfallMm = validated.precipitation.reduce((sum, value) => sum + value, 0)
  const datetime = parseIsoUtcDate(window.windowEnd)
  return {
    dataPoint: {
      sourceCode: WEATHER_OPENMETEO_SOURCE,
      metric: `${region.code.toUpperCase()}_RAINFALL_MM_90D`,
      datetime,
      value: Math.round(rainfallMm * 10) / 10,
      unit: "mm",
      raw: {
        source: "Open-Meteo Archive API",
        sourceUrl: OPEN_METEO_ARCHIVE_URL,
        requestedLatitude: region.latitude,
        requestedLongitude: region.longitude,
        responseLatitude: response.latitude ?? null,
        responseLongitude: response.longitude ?? null,
        regionCode: region.code,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        dayCount: window.dayCount,
        windowSemantics: "inclusive_end_minus_90_days_through_end",
        calculation: "sum(daily.precipitation_sum)",
        receivedDayCount: validated.times.length,
        timezone: "UTC",
      },
    },
    error: null,
  }
}

function pointKey(regionCode: string, anchorDate: string): string {
  return `${regionCode.toUpperCase()}_RAINFALL_MM_90D@${anchorDate}`
}

/** Strict all-or-nothing gate used by the manual apply path. */
export function assessHistoricalRainfallBatch(
  result: CommodityFetchResult,
  anchorDates: readonly string[],
  regionCodes: readonly WeatherRegionCode[],
): HistoricalRainfallBatchAssessment {
  const expected = new Set<string>()
  for (const regionCode of regionCodes) {
    for (const anchorDate of anchorDates) expected.add(pointKey(regionCode, anchorDate))
  }

  const actualCounts = new Map<string, number>()
  for (const point of result.dataPoints) {
    const key = `${point.metric}@${formatIsoDate(point.datetime)}`
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1)
  }
  const actual = new Set(actualCounts.keys())
  const missingKeys = [...expected].filter((key) => !actual.has(key)).sort()
  const unexpectedKeys = [...actual].filter((key) => !expected.has(key)).sort()
  const duplicateKeys = [...actualCounts]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort()
  const upstreamErrors = [...result.errors]
  return {
    ok:
      upstreamErrors.length === 0 &&
      missingKeys.length === 0 &&
      unexpectedKeys.length === 0 &&
      duplicateKeys.length === 0 &&
      result.dataPoints.length === expected.size,
    expectedCount: expected.size,
    actualCount: result.dataPoints.length,
    missingKeys,
    unexpectedKeys,
    duplicateKeys,
    upstreamErrors,
  }
}

/**
 * Pure orchestration seam for the manual command. In dry-run mode the
 * persistence callback is never invoked (and therefore can be a lazy dynamic
 * import in the CLI). An incomplete upstream batch also cannot reach writes.
 */
export async function executeHistoricalRainfallBackfill(args: {
  adapter: CommodityAdapter
  anchorDates: readonly string[]
  regionCodes: readonly WeatherRegionCode[]
  apply: boolean
  persist?: (result: CommodityFetchResult) => Promise<HistoricalRainfallPersistenceResult>
}): Promise<HistoricalRainfallExecutionResult> {
  const fetched = await args.adapter.fetch()
  const assessment = assessHistoricalRainfallBatch(
    fetched,
    args.anchorDates,
    args.regionCodes,
  )
  if (!assessment.ok || !args.apply) {
    return {
      fetched,
      assessment,
      writeAttempted: false,
      persistence: null,
    }
  }
  if (!args.persist) throw new Error("Apply mode requires a persistence callback")
  return {
    fetched,
    assessment,
    writeAttempted: true,
    persistence: await args.persist(fetched),
  }
}

export function createOpenMeteoHistoricalRainfallAdapter(
  opts: HistoricalRainfallAdapterOptions,
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  const anchorDates = [...new Set(opts.anchorDates)]
    .map((anchorDate) => buildLegacyRainfallWindow(anchorDate).windowEnd)
    .sort()
  if (anchorDates.length === 0) throw new Error("At least one historical rainfall anchor is required")

  const requestedCodes = opts.regionCodes ?? WEATHER_REGIONS.map((region) => region.code)
  const uniqueCodes = [...new Set(requestedCodes)]
  const regions = uniqueCodes.map((code) => {
    const region = WEATHER_REGIONS.find((candidate) => candidate.code === code)
    if (!region) throw new Error(`Unknown canonical weather region: ${String(code)}`)
    return region
  })
  if (regions.length === 0) throw new Error("At least one canonical weather region is required")
  const unionRange = buildHistoricalRainfallUnionRange(anchorDates)
  const timeoutMs = opts.timeoutMs ?? 15_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Historical rainfall timeout must be positive (got ${timeoutMs})`)
  }

  return {
    source: WEATHER_OPENMETEO_SOURCE,
    label: "Open-Meteo Historical Rainfall (manual backfill)",
    async fetch(): Promise<CommodityFetchResult> {
      const errors: string[] = []
      const dataPoints: CommodityDataPoint[] = []

      for (const region of regions) {
        const url = buildHistoricalRainfallUrl(region, unionRange)
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), timeoutMs)
        let response: Response
        try {
          response = await fetchImpl(url, { signal: controller.signal })
        } catch (error) {
          errors.push(
            `${region.code}@${unionRange.windowStart}..${unionRange.windowEnd}: fetch failed: ${error instanceof Error ? error.message : String(error)}`,
          )
          clearTimeout(timeout)
          continue
        }
        if (!response.ok) {
          clearTimeout(timeout)
          errors.push(
            `${region.code}@${unionRange.windowStart}..${unionRange.windowEnd}: HTTP ${response.status} from Open-Meteo Archive`,
          )
          continue
        }

        let parsed: OpenMeteoHistoricalRainfallResponse
        try {
          parsed = (await response.json()) as OpenMeteoHistoricalRainfallResponse
        } catch (error) {
          clearTimeout(timeout)
          errors.push(
            `${region.code}@${unionRange.windowStart}..${unionRange.windowEnd}: JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
          )
          continue
        }
        clearTimeout(timeout)
        const unionSeries = validateHistoricalDailySeries(unionRange, parsed)
        if (unionSeries.error !== null) {
          errors.push(
            `${region.code}@${unionRange.windowStart}..${unionRange.windowEnd}: ${unionSeries.error}`,
          )
          continue
        }

        const unionStart = parseIsoUtcDate(unionRange.windowStart)
        for (const anchorDate of anchorDates) {
          const window = buildLegacyRainfallWindow(anchorDate)
          const offset = inclusiveDayCount(
            unionStart,
            parseIsoUtcDate(window.windowStart),
          ) - 1
          const slicedResponse: OpenMeteoHistoricalRainfallResponse = {
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            daily_units: parsed.daily_units,
            daily: {
              time: unionSeries.times.slice(offset, offset + window.dayCount),
              precipitation_sum: unionSeries.precipitation.slice(offset, offset + window.dayCount),
            },
          }
          const converted = historicalRainfallResponseToDataPoint(region, window, slicedResponse)
          if (!converted.dataPoint) {
            errors.push(`${region.code}@${anchorDate}: ${converted.error ?? "unusable response"}`)
            continue
          }
          dataPoints.push(converted.dataPoint)
        }
      }

      return {
        source: WEATHER_OPENMETEO_SOURCE,
        dataPoints,
        errors,
        fetched: true,
      }
    },
  }
}
