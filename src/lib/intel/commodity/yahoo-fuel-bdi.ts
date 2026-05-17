/**
 * Phase 7.K — Yahoo Finance shipping & fuel adapter for logistics.
 *
 * **Sector served**: logistics primarily (LLS, ATL-MRKZ trucking,
 * SPARK freight). Also useful for industrial / hospitality input cost.
 *
 * **Symbols**:
 *   ^BDIY → Baltic Dry Index (dry-bulk shipping rates, no unit -- pure
 *           index). Forward indicator of global freight demand.
 *   HO=F  → NY Harbor ULSD (Ultra-Low Sulfur Diesel) futures, USD/gal.
 *           Proxy for diesel cost. Convert to USD/litre via × 0.264172
 *           (1 gal = 3.78541 L) for AZ-comparable units.
 *   RB=F  → RBOB Gasoline futures, USD/gal. Same conversion.
 *
 * **Metrics emitted**:
 *   BALTIC_DRY_INDEX        — points (no currency unit)
 *   DIESEL_USD_LITRE        — USD per litre, derived from HO=F
 *   GASOLINE_USD_LITRE      — USD per litre, derived from RB=F
 *
 * **Cadence**: monthly bars anchored to UTC 1st-of-month (matches
 * yahoo-grains + yahoo-metals + sugar-yahoo).
 *
 * **Failure isolation**: per-symbol.
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"

const FUEL_BDI_SOURCE = "yahoo-fuel-bdi"
const FUEL_BDI_LABEL = "Yahoo Finance Fuel + Baltic Dry Index"

interface FuelSymbol {
  yahoo: string
  metric: string
  unit: string
  factor: number
}

/** USD/gal → USD/litre: × 1 / 3.78541 = × 0.264172 */
const GAL_TO_LITRE = 0.264172

export const FUEL_BDI_SYMBOLS: readonly FuelSymbol[] = [
  { yahoo: "^BDIY", metric: "BALTIC_DRY_INDEX", unit: "index", factor: 1.0 },
  { yahoo: "HO=F", metric: "DIESEL_USD_LITRE", unit: "USD/L", factor: GAL_TO_LITRE },
  { yahoo: "RB=F", metric: "GASOLINE_USD_LITRE", unit: "USD/L", factor: GAL_TO_LITRE },
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

export function fuelBdiResponseToDataPoints(
  response: YahooChartResult,
  sym: FuelSymbol,
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
    const value = Math.round(close * sym.factor * 1000) / 1000
    points.push({
      sourceCode: FUEL_BDI_SOURCE,
      metric: sym.metric,
      datetime,
      value,
      unit: sym.unit,
      raw: { yahoo: sym.yahoo, closeRaw: close, timestamp: ts },
    })
  }
  points.sort((a, b) => a.datetime.getTime() - b.datetime.getTime())
  return points.slice(-maxMonths)
}

export function createYahooFuelBdiAdapter(
  opts: CommodityAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: FUEL_BDI_SOURCE,
    label: FUEL_BDI_LABEL,
    async fetch(): Promise<CommodityFetchResult> {
      const allPoints: CommodityDataPoint[] = []
      const errors: string[] = []
      let anyFetched = false
      for (const sym of FUEL_BDI_SYMBOLS) {
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
        const points = fuelBdiResponseToDataPoints(parsed, sym)
        if (points.length === 0) {
          errors.push(`${sym.metric}: no usable monthly bars`)
          continue
        }
        allPoints.push(...points)
      }
      return {
        source: FUEL_BDI_SOURCE,
        dataPoints: allPoints,
        errors,
        fetched: anyFetched,
      }
    },
  }
}

export const YAHOO_FUEL_BDI_SOURCE = FUEL_BDI_SOURCE
