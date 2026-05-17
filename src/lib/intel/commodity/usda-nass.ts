/**
 * Phase 7.K — USDA NASS Quick Stats poultry adapter.
 *
 * Plan originally called for `usda-wasde` (World Agricultural Supply
 * & Demand Estimates). WASDE itself ships only as PDF/Excel each month
 * with no API. **NASS Quick Stats** is the API equivalent that exposes
 * the same underlying production / price data as queryable JSON. We
 * stick to NASS for the same indicator coverage (broiler / egg / chick
 * placements).
 *
 * **Sector served**: poultry (AZSF / AAC poultry sub-companies). Feed
 * cost inputs already covered by yahoo-grains (corn/oats); this adapter
 * adds the output-side prices + forward-looking placements.
 *
 * **Source**: USDA NASS Quick Stats API
 *   https://quickstats.nass.usda.gov/api
 * Free with registration. Key gated via `opts.apiKey`; if null returns
 * api_key_missing without throwing (same graceful-degradation contract
 * as eia-energy).
 *
 * **Metrics emitted**:
 *   BROILER_PRICE_USD_LB    — wholesale broiler price, $/lb
 *   EGG_PRICE_USD_DOZ       — wholesale egg price, $/dozen
 *   CHICK_PLACEMENT_THOUSAND — chick placements, thousand head
 *
 * **Cadence**: weekly/monthly depending on series. Latest reported value
 * anchored to its actual `week_ending` or `month-1` UTC datetime.
 *
 * **Failure isolation**: per-series, mirroring eia-energy.
 */

import type {
  CommodityAdapter,
  CommodityFetchResult,
  CommodityAdapterOptions,
  CommodityDataPoint,
} from "./types"

const USDA_SOURCE = "usda-nass"
const USDA_LABEL = "USDA NASS Quick Stats (poultry)"
const USDA_BASE = "https://quickstats.nass.usda.gov/api/api_GET/"

interface UsdaSeries {
  metric: string
  unit: string
  params: Record<string, string>
}

/** Series catalog. Each entry → 1 API call. Filters chosen to return
 *  a small (≤ 50 rows) NATIONAL aggregate so we can pick the latest. */
export const USDA_SERIES: readonly UsdaSeries[] = [
  {
    metric: "BROILER_PRICE_USD_LB",
    unit: "USD/lb",
    params: {
      commodity_desc: "BROILERS",
      statisticcat_desc: "PRICE RECEIVED",
      agg_level_desc: "NATIONAL",
      freq_desc: "MONTHLY",
    },
  },
  {
    metric: "EGG_PRICE_USD_DOZ",
    unit: "USD/dozen",
    params: {
      commodity_desc: "EGGS",
      statisticcat_desc: "PRICE RECEIVED",
      agg_level_desc: "NATIONAL",
      freq_desc: "MONTHLY",
    },
  },
  {
    metric: "CHICK_PLACEMENT_THOUSAND",
    unit: "thousand head",
    params: {
      commodity_desc: "CHICKENS, BROILERS",
      statisticcat_desc: "PLACEMENTS",
      agg_level_desc: "NATIONAL",
      freq_desc: "WEEKLY",
    },
  },
]

interface UsdaApiResponse {
  data?: Array<{
    year?: number | string
    begin_code?: string
    end_code?: string
    week_ending?: string
    reference_period_desc?: string
    Value?: string | number
  }>
}

export interface UsdaAdapterOptions extends CommodityAdapterOptions {
  /** Free key from quickstats.nass.usda.gov. */
  apiKey?: string | null
}

/**
 * Build the API URL for one series. Pure helper for testability.
 */
export function buildUsdaUrl(series: UsdaSeries, apiKey: string): string {
  const params = new URLSearchParams({
    key: apiKey,
    format: "JSON",
    ...series.params,
  })
  return `${USDA_BASE}?${params.toString()}`
}

/**
 * Convert one USDA response → latest data point for that series.
 * "Latest" = max(week_ending) / max(year-month). Pure helper.
 */
export function usdaResponseToDataPoint(
  response: UsdaApiResponse,
  series: UsdaSeries,
): CommodityDataPoint | null {
  const rows = response?.data
  if (!Array.isArray(rows) || rows.length === 0) return null

  /** Compute a comparable Date from the row. Weekly rows use
   *  `week_ending` (YYYY-MM-DD); monthly rows use `year` +
   *  `reference_period_desc` (month name) → first-of-month UTC. */
  const dateOf = (row: NonNullable<UsdaApiResponse["data"]>[number]): Date | null => {
    if (row.week_ending && /^\d{4}-\d{2}-\d{2}$/.test(row.week_ending)) {
      return new Date(`${row.week_ending}T00:00:00Z`)
    }
    const year = Number(row.year)
    if (!Number.isFinite(year)) return null
    const months: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    }
    const desc = (row.reference_period_desc ?? "").toLowerCase().slice(0, 3)
    const m = months[desc]
    if (!m) return null
    return new Date(Date.UTC(year, m - 1, 1))
  }

  let best: { d: Date; v: number; raw: unknown } | null = null
  for (const row of rows) {
    const d = dateOf(row)
    if (!d || Number.isNaN(d.getTime())) continue
    const v = Number(String(row.Value ?? "").replace(/,/g, ""))
    if (!Number.isFinite(v)) continue
    if (!best || d.getTime() > best.d.getTime()) {
      best = { d, v, raw: row }
    }
  }
  if (!best) return null
  return {
    sourceCode: USDA_SOURCE,
    metric: series.metric,
    datetime: best.d,
    value: best.v,
    unit: series.unit,
    raw: { row: best.raw },
  }
}

export function createUSDANassAdapter(
  opts: UsdaAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  const apiKey = opts.apiKey ?? null
  return {
    source: USDA_SOURCE,
    label: USDA_LABEL,
    async fetch(): Promise<CommodityFetchResult> {
      if (!apiKey) {
        return {
          source: USDA_SOURCE,
          dataPoints: [],
          errors: [
            "api_key_missing — set Organization.settings.apiKeys.usda to a free key from quickstats.nass.usda.gov",
          ],
          fetched: false,
        }
      }
      const allPoints: CommodityDataPoint[] = []
      const errors: string[] = []
      let anyFetched = false
      for (const series of USDA_SERIES) {
        const url = buildUsdaUrl(series, apiKey)
        let response: Response
        try {
          response = await fetchImpl(url)
        } catch (e) {
          errors.push(
            `${series.metric}: fetch failed: ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        anyFetched = true
        if (!response.ok) {
          errors.push(`${series.metric}: HTTP ${response.status}`)
          continue
        }
        let parsed: UsdaApiResponse
        try {
          parsed = (await response.json()) as UsdaApiResponse
        } catch (e) {
          errors.push(
            `${series.metric}: JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        const point = usdaResponseToDataPoint(parsed, series)
        if (!point) {
          errors.push(`${series.metric}: no usable rows in response`)
          continue
        }
        allPoints.push(point)
      }
      return {
        source: USDA_SOURCE,
        dataPoints: allPoints,
        errors,
        fetched: anyFetched,
      }
    },
  }
}

export const USDA_NASS_SOURCE = USDA_SOURCE
