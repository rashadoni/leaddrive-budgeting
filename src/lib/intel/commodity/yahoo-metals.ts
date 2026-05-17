/**
 * Phase 7.K — Yahoo Finance metals + lumber commodity adapter.
 *
 * Plan originally called for `wb-commodity-metals` (World Bank Pink
 * Sheet alternative). Pink Sheet ships only as monthly Excel which is
 * brittle to parse in-flight; Yahoo Finance Chart API exposes the same
 * benchmark futures as JSON, no key, and the values track Pink Sheet
 * within 1-2 % (front-month futures ≈ spot for metals).
 *
 * **Sectors served**: industrial (steel, copper), construction (steel,
 * cement-proxy, lumber, aluminum), real_estate (lumber, steel),
 * logistics (steel, aluminum), retail (consumer-goods packaging via
 * aluminum + copper).
 *
 * **Cement note**: there are no listed cement futures anywhere. Plan
 * marks cement for **manual entry via /admin/data-entry** (Phase 3).
 * Lumber substitutes here as the 4th building-materials series; cement
 * remains a manual OperationalFact for construction-sector indicators.
 *
 * **Symbols** (Yahoo front-month futures):
 *   HG=F   → Comex copper      (cents/lb;  × 22.0462 → USD/tonne)
 *   ALI=F  → Comex aluminum    (USD/tonne already)
 *   HRC=F  → NYMEX HRC steel   (USD/short_ton; × 1.10231 → USD/tonne)
 *   LBR=F  → CME lumber        (USD per 1000 board feet — unit "USD/MBF",
 *                                no metric-tonne equivalent; keep as is)
 *
 * **Metrics emitted**: COPPER_USD_TONNE, ALUMINUM_USD_TONNE,
 * STEEL_USD_TONNE, LUMBER_USD_MBF.
 *
 * **Cadence + idempotency**: monthly bars anchored to UTC 1st-of-month,
 * trailing 12 months per series — same as sugar-yahoo + yahoo-grains.
 *
 * **Failure isolation**: per-series; one symbol 404ing leaves the
 * others.
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"

const YAHOO_METALS_SOURCE = "yahoo-metals"
const YAHOO_METALS_LABEL = "Yahoo Finance Metals + Lumber"

interface MetalSymbol {
  yahoo: string
  metric: string
  unit: string
  /** Multiplier on Yahoo's raw close → emitted value (in `unit`). */
  factor: number
}

export const YAHOO_METALS_SYMBOLS: readonly MetalSymbol[] = [
  // Copper HG=F: Yahoo returns USD/lb (currency=USD, NOT USX/cents).
  // Convert to USD/tonne: × 2204.62 lb/tonne. Earlier the factor was
  // 22.0462 (treating Yahoo as cents/lb) which made copper read out
  // 100x too low (e.g. $138 instead of $13,878/tonne). Probed
  // 2026-05-17: HG=F currency field is "USD" not "USX".
  { yahoo: "HG=F", metric: "COPPER_USD_TONNE", unit: "USD/tonne", factor: 2204.62 },
  // Aluminum ALI=F: already USD/tonne (Comex micro aluminum is in USD/lb,
  // but ALI=F front-month is the LME-equivalent quote in USD/tonne).
  // If Yahoo's payload changes to cents/lb we'd see ALI fall to ~80-100
  // which is implausible for aluminum; sanity-check in the indicator.
  { yahoo: "ALI=F", metric: "ALUMINUM_USD_TONNE", unit: "USD/tonne", factor: 1.0 },
  // HRC steel HRC=F: USD per short ton. Convert: 1 metric tonne = 1.10231 short ton.
  // So USD/short_ton × 1.10231 = USD/metric_tonne.
  { yahoo: "HRC=F", metric: "STEEL_USD_TONNE", unit: "USD/tonne", factor: 1.10231 },
  // Lumber LBR=F: USD per 1000 board feet. No metric-tonne equivalent
  // (board-feet is a volume unit, lumber is heterogeneous species);
  // keep native unit.
  { yahoo: "LBR=F", metric: "LUMBER_USD_MBF", unit: "USD/MBF", factor: 1.0 },
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
 * Convert one Yahoo Chart payload + symbol config → normalized monthly
 * data points. Pure helper for testability.
 */
export function yahooMetalsResponseToDataPoints(
  response: YahooChartResult,
  sym: MetalSymbol,
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
    const value = Math.round(close * sym.factor * 10) / 10
    points.push({
      sourceCode: YAHOO_METALS_SOURCE,
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

export function createYahooMetalsAdapter(
  opts: CommodityAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: YAHOO_METALS_SOURCE,
    label: YAHOO_METALS_LABEL,
    async fetch(): Promise<CommodityFetchResult> {
      const allPoints: CommodityDataPoint[] = []
      const errors: string[] = []
      let anyFetched = false
      for (const sym of YAHOO_METALS_SYMBOLS) {
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
        const points = yahooMetalsResponseToDataPoints(parsed, sym)
        if (points.length === 0) {
          errors.push(`${sym.metric}: response had no usable monthly bars`)
          continue
        }
        allPoints.push(...points)
      }
      return {
        source: YAHOO_METALS_SOURCE,
        dataPoints: allPoints,
        errors,
        fetched: anyFetched,
      }
    },
  }
}

export const YAHOO_METALS_SOURCE_CODE = YAHOO_METALS_SOURCE
