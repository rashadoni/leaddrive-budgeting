/**
 * Phase 7.G Turn LXXXXV (Phase 7.E #1 D.5b) — World Bank CPI adapter.
 *
 * Pulls year-over-year CPI inflation for AZ + RU + TR + neighboring
 * economies. Source: World Bank Open Data API (free, unauthenticated).
 *
 * **Why CPI matters:** holding sales prices float vs inflation; cost
 * baselines (utilities, labor, leases) re-anchor monthly. CPI delta
 * vs prior period is a leading indicator for variance attribution
 * (e.g. "REV margin compression — AZ CPI +12% YoY pushed labor cost
 * past indexed contracts").
 *
 * **Update cadence:** monthly — data publishes with 1-3 month lag.
 * Adapter writes 1 data point per (country, month). Idempotent via
 * Prisma `(orgId, sourceCode, metric, datetime)` unique constraint.
 *
 * **Endpoint:** `https://api.worldbank.org/v2/country/{country}/indicator/FP.CPI.TOTL.ZG`
 * - `FP.CPI.TOTL.ZG` = inflation, consumer prices (annual %)
 * - `format=json` returns paginated array; we pull last 12 months
 * - No auth required, no rate limit advertised
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityFetchResult,
  CommodityDataPoint,
} from "./types"

const WB_SOURCE = "worldbank-cpi"
const WB_LABEL = "World Bank — CPI YoY (regional)"
/** ISO-2 country codes — coverage matches FO holding's procurement footprint. */
const WB_COUNTRIES = ["AZ", "RU", "TR", "GE", "IR"] as const
const WB_INDICATOR = "FP.CPI.TOTL.ZG"

interface WBDataPoint {
  date?: string // YYYY (annual data)
  value?: number | null
  countryiso3code?: string
  country?: { id?: string; value?: string }
}

/** WB API returns a 2-element array: [meta, data[]]. We only care about data[]. */
type WBResponse = [unknown, WBDataPoint[]] | unknown

export function wbResponseToDataPoints(
  response: WBResponse,
  countryCode: string,
): CommodityDataPoint[] {
  if (!Array.isArray(response) || response.length < 2) return []
  const dataArray = response[1]
  if (!Array.isArray(dataArray)) return []
  const points: CommodityDataPoint[] = []
  for (const row of dataArray) {
    if (!row || typeof row !== "object") continue
    const r = row as WBDataPoint
    if (typeof r.date !== "string") continue
    if (typeof r.value !== "number" || !Number.isFinite(r.value)) continue
    // WB annual data — anchor to YYYY-12-31 UTC for ordering consistency
    const year = parseInt(r.date, 10)
    if (Number.isNaN(year)) continue
    const datetime = new Date(Date.UTC(year, 11, 31))
    points.push({
      sourceCode: WB_SOURCE,
      metric: `${countryCode}_CPI_YOY`,
      datetime,
      value: r.value,
      unit: "%",
      raw: { date: r.date, country: r.countryiso3code ?? countryCode },
    })
  }
  return points
}

export function createWorldBankCPIAdapter(
  opts: CommodityAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: WB_SOURCE,
    label: WB_LABEL,
    async fetch(): Promise<CommodityFetchResult> {
      const allPoints: CommodityDataPoint[] = []
      const errors: string[] = []
      let anyFetched = false

      for (const country of WB_COUNTRIES) {
        const url = `https://api.worldbank.org/v2/country/${country}/indicator/${WB_INDICATOR}?format=json&per_page=10`
        let response: Response
        try {
          response = await fetchImpl(url)
          anyFetched = true
        } catch (e) {
          errors.push(
            `${country}: fetch failed — ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        if (!response.ok) {
          errors.push(`${country}: HTTP ${response.status}`)
          continue
        }
        let parsed: WBResponse
        try {
          parsed = (await response.json()) as WBResponse
        } catch (e) {
          errors.push(
            `${country}: JSON parse failed — ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        const points = wbResponseToDataPoints(parsed, country)
        if (points.length === 0) {
          errors.push(`${country}: no usable data points returned`)
        }
        allPoints.push(...points)
      }

      return {
        source: WB_SOURCE,
        dataPoints: allPoints,
        errors,
        fetched: anyFetched,
      }
    },
  }
}

export const WB_CPI_SOURCE = WB_SOURCE
