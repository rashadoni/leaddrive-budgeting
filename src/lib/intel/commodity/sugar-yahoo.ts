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
 * to populate a rolling year. Spec (unofficial):
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

export const SUGAR_YAHOO_SOURCE = SUGAR_SOURCE
export const SUGAR_YAHOO_METRIC = SUGAR_METRIC
