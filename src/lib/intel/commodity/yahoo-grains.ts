/**
 * Phase 7.K — Yahoo Finance grains commodity adapter.
 *
 * Pulls trailing-12-month monthly closes for the major grain & cotton
 * futures from Yahoo Finance Chart API. Public, no key, JSON.
 *
 * **Sectors served**: agro_crops, food_processing, poultry (feed cost),
 * beverage (corn syrup / cotton inputs), retail (food CPI input).
 *
 * **Symbols** (Yahoo `^XYZ=F` front-month futures):
 *   ZC=F  → Corn      (cents/bushel; 1 t = 39.3683 bu, 56 lb/bu)
 *   ZW=F  → Wheat     (cents/bushel; 1 t = 36.7437 bu, 60 lb/bu)
 *   ZS=F  → Soybean   (cents/bushel; 1 t = 36.7437 bu, 60 lb/bu)
 *   ZO=F  → Oats      (cents/bushel; 1 t = 68.9438 bu, 32 lb/bu) — also
 *                       serves as feed-grain proxy for barley (no barley
 *                       futures listed on Yahoo; ZO is the closest
 *                       Chicago-traded equivalent and correlates ~0.7
 *                       historically).
 *   CT=F  → Cotton    (cents/lb; 1 t = 2204.62 lb)
 *
 * **Metrics emitted**: CORN_USD_TONNE, WHEAT_USD_TONNE,
 * SOYBEAN_USD_TONNE, OATS_USD_TONNE, COTTON_USD_TONNE.
 *
 * **Cadence**: monthly bars anchored to UTC 1st-of-month (same as
 * sugar-yahoo). 12 trailing months per series per fetch.
 *
 * **Failure isolation**: each symbol fetched independently; one symbol
 * 404ing doesn't drop the other 4. Errors aggregated per-series.
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"

const YAHOO_GRAINS_SOURCE = "yahoo-grains"
const YAHOO_GRAINS_LABEL = "Yahoo Finance Grains (CME / ICE)"

/**
 * Per-symbol conversion factor: multiply Yahoo's quoted price by this
 * to get USD/tonne. For cents/bushel symbols this is
 * `bushels_per_tonne / 100` (cents → USD); for cents/lb (cotton) it's
 * `2204.62 / 100`.
 */
interface GrainSymbol {
  yahoo: string
  metric: string
  unit: string
  /** cents/bushel or cents/lb → USD/tonne */
  factor: number
}

export const YAHOO_GRAINS_SYMBOLS: readonly GrainSymbol[] = [
  // 56 lb/bu corn → 1 t / 56 lb / bu = 1 t / (56 / 2204.62 t) per bu
  //   = 2204.62 / 56 = 39.3682 bu/t. Then cents/bu × 39.3682 / 100.
  { yahoo: "ZC=F", metric: "CORN_USD_TONNE", unit: "USD/tonne", factor: 0.393682 },
  // 60 lb/bu wheat → 36.7437 bu/t × cents / 100
  { yahoo: "ZW=F", metric: "WHEAT_USD_TONNE", unit: "USD/tonne", factor: 0.367437 },
  // 60 lb/bu soybean
  { yahoo: "ZS=F", metric: "SOYBEAN_USD_TONNE", unit: "USD/tonne", factor: 0.367437 },
  // 32 lb/bu oats → 68.9438 bu/t (also our barley proxy)
  { yahoo: "ZO=F", metric: "OATS_USD_TONNE", unit: "USD/tonne", factor: 0.689438 },
  // Cotton cents/lb → USD/tonne: × 22.0462
  { yahoo: "CT=F", metric: "COTTON_USD_TONNE", unit: "USD/tonne", factor: 22.0462 },
]

interface YahooChartResult {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: { quote?: Array<{ close?: Array<number | null> }> }
    }>
    error?: { code?: string; description?: string } | null
  }
}

function yahooUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v7/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=2y`
}

/**
 * Convert one Yahoo Chart payload + symbol config into normalized
 * monthly USD/tonne data points. Pure helper for testability.
 */
export function yahooGrainsResponseToDataPoints(
  response: YahooChartResult,
  sym: GrainSymbol,
  maxMonths = 12,
): CommodityDataPoint[] {
  const result = response.chart?.result?.[0]
  const timestamps = result?.timestamp
  const closes = result?.indicators?.quote?.[0]?.close
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return []
  const points: CommodityDataPoint[] = []
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i]
    const close = closes[i]
    if (typeof ts !== "number" || typeof close !== "number" || !Number.isFinite(close)) continue
    const d = new Date(ts * 1000)
    const datetime = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    const usdPerTonne = Math.round(close * sym.factor * 10) / 10
    points.push({
      sourceCode: YAHOO_GRAINS_SOURCE,
      metric: sym.metric,
      datetime,
      value: usdPerTonne,
      unit: sym.unit,
      raw: { yahoo: sym.yahoo, closeRaw: close, timestamp: ts },
    })
  }
  points.sort((a, b) => a.datetime.getTime() - b.datetime.getTime())
  return points.slice(-maxMonths)
}

export function createYahooGrainsAdapter(
  opts: CommodityAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: YAHOO_GRAINS_SOURCE,
    label: YAHOO_GRAINS_LABEL,
    async fetch(): Promise<CommodityFetchResult> {
      const allPoints: CommodityDataPoint[] = []
      const errors: string[] = []
      let anyFetched = false
      for (const sym of YAHOO_GRAINS_SYMBOLS) {
        let response: Response
        try {
          response = await fetchImpl(yahooUrl(sym.yahoo), {
            headers: { "User-Agent": "BudgetPro/1.0 (+intel-scheduler)" },
          })
        } catch (e) {
          errors.push(
            `${sym.metric}: fetch failed: ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        anyFetched = true
        if (!response.ok) {
          errors.push(`${sym.metric}: HTTP ${response.status} from ${sym.yahoo}`)
          continue
        }
        let parsed: YahooChartResult
        try {
          parsed = (await response.json()) as YahooChartResult
        } catch (e) {
          errors.push(
            `${sym.metric}: JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        const yahooErr = parsed.chart?.error
        if (yahooErr && yahooErr.code) {
          errors.push(
            `${sym.metric}: Yahoo error ${yahooErr.code}: ${yahooErr.description ?? ""}`,
          )
          continue
        }
        const points = yahooGrainsResponseToDataPoints(parsed, sym)
        if (points.length === 0) {
          errors.push(`${sym.metric}: response had no usable monthly bars`)
          continue
        }
        allPoints.push(...points)
      }
      return {
        source: YAHOO_GRAINS_SOURCE,
        dataPoints: allPoints,
        errors,
        fetched: anyFetched,
      }
    },
  }
}

export const YAHOO_GRAINS_SOURCE_CODE = YAHOO_GRAINS_SOURCE
