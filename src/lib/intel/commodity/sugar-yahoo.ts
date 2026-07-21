/**
 * Phase 7.I — Yahoo Finance sugar (#11 raw cane) commodity adapter.
 *
 * Pulls trailing-12-month monthly closes for ICE Sugar #11 futures (`SB=F`)
 * — the global benchmark cane-sugar price. Yahoo Finance Chart API is
 * publicly callable, no key, JSON shape. World Bank Pink Sheet has the
 * same data in XLSX form but requires Excel-parsing in-flight; the Yahoo
 * endpoint is the lower-cost equivalent. Switching to Pink Sheet is a
 * single-file swap.
 *
 * **Metric emitted:** `SUGAR_RAW_USD_TONNE` — converted from cents/lb
 * (Yahoo's quote unit) to USD/tonne using the canonical conversion:
 *   USD/tonne = cents/lb × 22.0462 (lb → kg → tonne) ÷ 100 (cents → USD)
 *
 * **Datetime cadence:** one point per month, anchored to the 1st of month
 * UTC. The fetch returns 12 trailing months in one call; the ingest layer
 * upserts them all idempotently via `(orgId, source, metric, datetime)`.
 *
 * **Why monthly:** the Pink Sheet itself is monthly. Daily-close sugar
 * is noisy and indicators consume 12M means + stdev — monthly granularity
 * is sufficient. If we ever need daily, the same adapter with a different
 * `interval` query param does it.
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"

const SUGAR_SOURCE = "sugar-yahoo-sb-f"
const SUGAR_LABEL = "ICE Sugar #11 (Yahoo Finance / monthly)"
const SUGAR_METRIC = "SUGAR_RAW_USD_TONNE"

/**
 * Yahoo Finance Chart API endpoint. `SB=F` = front-month ICE Sugar #11.
 * `interval=1mo&range=2y` returns ~24 monthly bars — we take the last 12
 * to populate a rolling year. Historical backfill uses the same endpoint
 * with explicit Unix `period1` (inclusive) / `period2` (exclusive) bounds.
 * The historical variant requests daily bars and preserves the last observed
 * trading close of each calendar month, avoiding an upstream monthly-bar gap.
 * Spec (unofficial):
 *   https://query1.finance.yahoo.com/v7/finance/chart/{symbol}
 */
const YAHOO_SUGAR_URL =
  "https://query1.finance.yahoo.com/v7/finance/chart/SB=F?interval=1mo&range=2y"

/** Conversion: cents/lb → USD/tonne. 1 tonne = 2204.62 lb; 100 cents = 1 USD. */
const CENTS_PER_LB_TO_USD_PER_TONNE = 22.0462

interface YahooChartResult {
  chart?: {
    result?: Array<{
      timestamp?: number[] // unix seconds
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>
        }>
      }
    }>
    error?: { code?: string; description?: string } | null
  }
}

export interface SugarYahooHistoryRange {
  /** Inclusive UTC month boundary. */
  start: Date
  /** Exclusive UTC month boundary. */
  end: Date
}

function isExactUtcMonthStart(date: Date): boolean {
  return (
    date.getUTCDate() === 1 &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  )
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

export function sugarYahooHistoryRangeForYear(year: number): SugarYahooHistoryRange {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new Error(`Historical sugar year must be an integer from 1900 to 2100; got ${year}`)
  }
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  }
}

/**
 * Build the public Yahoo Chart URL for an exact historical range. `period1`
 * is inclusive and `period2` exclusive. Keeping this explicit prevents a
 * current trailing-range request from silently filling a historical period.
 */
export function sugarYahooHistoricalUrl(range: SugarYahooHistoryRange): string {
  if (
    !isExactUtcMonthStart(range.start) ||
    !isExactUtcMonthStart(range.end) ||
    range.start.getTime() >= range.end.getTime()
  ) {
    throw new Error("Historical sugar range must use increasing UTC month-start boundaries")
  }
  const params = new URLSearchParams({
    // Yahoo's 2025 monthly endpoint omits June. Daily bars contain an actual
    // June 30 close, so group real daily observations deterministically below
    // rather than interpolating a missing monthly value.
    interval: "1d",
    period1: String(epochSeconds(range.start)),
    period2: String(epochSeconds(range.end)),
  })
  return `https://query1.finance.yahoo.com/v8/finance/chart/SB%3DF?${params.toString()}`
}

/**
 * Convert one Yahoo Chart payload into normalized monthly USD/tonne data
 * points. Pure helper so tests can pin the conversion math against a
 * canned fixture. Anchors each point to the 1st-of-month UTC for
 * idempotency.
 *
 * Returns the last `maxMonths` available bars (defaults to 12) — older
 * data not load-bearing for current-month indicators.
 */
export function yahooSugarResponseToDataPoints(
  response: YahooChartResult,
  now: Date = new Date(),
  maxMonths = 12,
): CommodityDataPoint[] {
  void now
  const result = response.chart?.result?.[0]
  const timestamps = result?.timestamp
  const closes = result?.indicators?.quote?.[0]?.close
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return []
  const points: CommodityDataPoint[] = []
  // Pair each timestamp with its close; drop null/NaN closes (Yahoo
  // sometimes nulls the most recent bar mid-day).
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i]
    const close = closes[i]
    if (typeof ts !== "number" || typeof close !== "number" || !Number.isFinite(close)) continue
    const d = new Date(ts * 1000)
    // Anchor to 1st-of-month UTC.
    const datetime = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    const usdPerTonne = Math.round(close * CENTS_PER_LB_TO_USD_PER_TONNE * 10) / 10
    points.push({
      sourceCode: SUGAR_SOURCE,
      metric: SUGAR_METRIC,
      datetime,
      value: usdPerTonne,
      unit: "USD/tonne",
      raw: { closeCentsLb: close, timestamp: ts },
    })
  }
  // Trailing N months — most recent last after sort.
  points.sort((a, b) => a.datetime.getTime() - b.datetime.getTime())
  return points.slice(-maxMonths)
}

/**
 * Normalize real daily Yahoo bars inside the requested historical range into
 * one monthly point: the final valid trading close in each UTC calendar
 * month. Rows outside `[start, end)` are discarded defensively even when
 * Yahoo honours the URL bounds. A month with no daily bar stays missing — no
 * interpolation, forward-fill, or zero is ever emitted.
 */
export function yahooSugarHistoricalResponseToDataPoints(
  response: YahooChartResult,
  range: SugarYahooHistoryRange,
): CommodityDataPoint[] {
  const query = {
    endpoint: "yahoo-chart-v8",
    symbol: "SB=F",
    interval: "1d",
    period1: epochSeconds(range.start),
    period2: epochSeconds(range.end),
    period1Inclusive: true,
    period2Exclusive: true,
  }
  const result = response.chart?.result?.[0]
  const timestamps = result?.timestamp
  const closes = result?.indicators?.quote?.[0]?.close
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return []
  const lastByMonth = new Map<string, { timestamp: number; close: number; datetime: Date }>()
  for (let i = 0; i < timestamps.length; i += 1) {
    const timestamp = timestamps[i]
    const close = closes[i]
    if (typeof timestamp !== "number" || typeof close !== "number" || !Number.isFinite(close)) continue
    const observedAt = new Date(timestamp * 1000)
    if (observedAt < range.start || observedAt >= range.end) continue
    const datetime = new Date(Date.UTC(observedAt.getUTCFullYear(), observedAt.getUTCMonth(), 1))
    const key = datetime.toISOString()
    const existing = lastByMonth.get(key)
    if (!existing || timestamp > existing.timestamp) {
      lastByMonth.set(key, { timestamp, close, datetime })
    }
  }
  return [...lastByMonth.values()]
    .sort((a, b) => a.datetime.getTime() - b.datetime.getTime())
    .map(({ timestamp, close, datetime }) => ({
      sourceCode: SUGAR_SOURCE,
      metric: SUGAR_METRIC,
      datetime,
      value: Math.round(close * CENTS_PER_LB_TO_USD_PER_TONNE * 10) / 10,
      unit: "USD/tonne",
      raw: {
        closeCentsLb: close,
        timestamp,
        observedAt: new Date(timestamp * 1000).toISOString(),
        aggregation: "last_daily_close",
        query,
        requestedStart: range.start.toISOString(),
        requestedEnd: range.end.toISOString(),
        cadence: "monthly",
      },
    }))
}

export function createSugarYahooAdapter(
  opts: CommodityAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: SUGAR_SOURCE,
    label: SUGAR_LABEL,
    async fetch(now: Date = new Date()): Promise<CommodityFetchResult> {
      const errors: string[] = []
      let response: Response
      try {
        response = await fetchImpl(YAHOO_SUGAR_URL, {
          // Yahoo Finance rejects requests without a User-Agent header
          // ("Edge: Your access to this site is rate-limited" 401). The
          // string itself isn't important; presence is.
          headers: { "User-Agent": "BudgetPro/1.0 (+intel-scheduler)" },
        })
      } catch (e) {
        return {
          source: SUGAR_SOURCE,
          dataPoints: [],
          errors: [`fetch failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: false,
        }
      }
      if (!response.ok) {
        return {
          source: SUGAR_SOURCE,
          dataPoints: [],
          errors: [`HTTP ${response.status} from ${YAHOO_SUGAR_URL}`],
          fetched: true,
        }
      }
      let parsed: YahooChartResult
      try {
        parsed = (await response.json()) as YahooChartResult
      } catch (e) {
        return {
          source: SUGAR_SOURCE,
          dataPoints: [],
          errors: [`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: true,
        }
      }
      const yahooErr = parsed.chart?.error
      if (yahooErr && yahooErr.code) {
        errors.push(`Yahoo error ${yahooErr.code}: ${yahooErr.description ?? ""}`)
      }
      const points = yahooSugarResponseToDataPoints(parsed, now)
      if (points.length === 0 && errors.length === 0) {
        errors.push(
          `Response had no usable monthly bars (got: ${JSON.stringify(parsed.chart ?? null).slice(0, 100)})`,
        )
      }
      return { source: SUGAR_SOURCE, dataPoints: points, errors, fetched: true }
    },
  }
}

/**
 * Free, explicit historical variant for a one-year manual backfill. It is
 * deliberately not part of the scheduled adapter factory: callers must name
 * the target year and invoke the separate dry-run-first operations path.
 */
export function createSugarYahooHistoricalAdapter(
  year: number,
  opts: CommodityAdapterOptions = {},
): CommodityAdapter {
  const range = sugarYahooHistoryRangeForYear(year)
  const url = sugarYahooHistoricalUrl(range)
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: SUGAR_SOURCE,
    label: `${SUGAR_LABEL} / historical ${year}`,
    async fetch(): Promise<CommodityFetchResult> {
      let response: Response
      try {
        response = await fetchImpl(url, {
          headers: { "User-Agent": "BudgetPro/1.0 (+intel-history-backfill)" },
        })
      } catch (e) {
        return {
          source: SUGAR_SOURCE,
          dataPoints: [],
          errors: [`fetch failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: false,
        }
      }
      if (!response.ok) {
        return {
          source: SUGAR_SOURCE,
          dataPoints: [],
          errors: [`HTTP ${response.status} from ${url}`],
          fetched: true,
        }
      }
      let parsed: YahooChartResult
      try {
        parsed = (await response.json()) as YahooChartResult
      } catch (e) {
        return {
          source: SUGAR_SOURCE,
          dataPoints: [],
          errors: [`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: true,
        }
      }
      const errors: string[] = []
      const yahooErr = parsed.chart?.error
      if (yahooErr?.code) {
        errors.push(`Yahoo error ${yahooErr.code}: ${yahooErr.description ?? ""}`)
      }
      const dataPoints = yahooSugarHistoricalResponseToDataPoints(parsed, range)
      if (dataPoints.length === 0 && errors.length === 0) {
        errors.push("Response had no usable monthly bars inside requested historical range")
      }
      return { source: SUGAR_SOURCE, dataPoints, errors, fetched: true }
    },
  }
}

export const SUGAR_YAHOO_SOURCE = SUGAR_SOURCE
export const SUGAR_YAHOO_METRIC = SUGAR_METRIC
