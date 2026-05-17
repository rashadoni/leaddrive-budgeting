/**
 * Phase 7.K — UN Comtrade adapter (AZ trade flows).
 *
 * **Sector served**: services (cross-border-services-adjacent),
 * logistics (import/export volume drives freight demand), retail
 * (imports influence inventory mix), industrial (export demand).
 *
 * UN Comtrade focuses on **goods** trade (services trade is in UN
 * STS, a separate dataset). Goods trade is the most consistent
 * cross-country dataset and serves as the macro signal for the
 * downstream sectors.
 *
 * **Source**: UN Comtrade v1 public preview endpoint
 *   https://comtradeapi.un.org/public/v1/preview/C/A/HS
 * Free, no key required for low-volume (≤100/hr) "preview" tier.
 *
 * **Reporter**: AZ country code = 031.
 * **Period**: annual (latest 2 years), so we always have a
 * year-over-year comparison.
 *
 * **Metrics emitted**:
 *   AZ_GOODS_EXPORTS_USD   — total exports value (annual)
 *   AZ_GOODS_IMPORTS_USD   — total imports value (annual)
 *   AZ_TRADE_BALANCE_USD   — exports minus imports (derived)
 *
 * Anchored to UTC 1st-of-January for the reported year.
 *
 * **Cadence**: monthly polling (Comtrade revises ~quarterly with a lag
 * of 2-3 months). Idempotent via the unique constraint.
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"

const COMTRADE_SOURCE = "un-comtrade-az"
const COMTRADE_LABEL = "UN Comtrade — Azerbaijan trade flows"
const COMTRADE_BASE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"

/** AZ reporter code in UN M49 country list. */
const AZ_REPORTER = "031"

interface ComtradeRow {
  period?: number | string
  flowCode?: string | number
  flowDesc?: string
  primaryValue?: number
  partnerCode?: number | string
  cmdCode?: string
}

interface ComtradeResponse {
  data?: ComtradeRow[]
  count?: number
}

/**
 * Build the Comtrade URL for AZ totals, last 2 reported years.
 * Pure helper for testability.
 */
export function buildComtradeUrl(now: Date = new Date()): string {
  const year = now.getUTCFullYear()
  // Comtrade lags 2-3 months; we ask for last 2 years to maximize
  // the chance of getting at least one populated row.
  const periods = [year - 1, year - 2].join(",")
  const params = new URLSearchParams({
    reporterCode: AZ_REPORTER,
    period: periods,
    partnerCode: "0", // 0 = World
    motCode: "0", // 0 = All modes of transport
    customsCode: "C00", // C00 = All
    flowCode: "M,X", // M = imports, X = exports
    cmdCode: "TOTAL", // TOTAL = all commodities
    format: "JSON",
  })
  return `${COMTRADE_BASE}?${params.toString()}`
}

/**
 * Convert Comtrade payload → 3 normalized data points (exports +
 * imports + balance) for the most recent year that has BOTH M and X
 * present. Pure helper for testability.
 */
export function comtradeResponseToDataPoints(
  response: ComtradeResponse,
): CommodityDataPoint[] {
  const rows = response?.data
  if (!Array.isArray(rows) || rows.length === 0) return []

  // Group by year → { exports, imports }
  const byYear = new Map<number, { exports?: number; imports?: number }>()
  for (const row of rows) {
    const year = Number(row.period)
    if (!Number.isFinite(year)) continue
    const value = Number(row.primaryValue)
    if (!Number.isFinite(value)) continue
    const code = String(row.flowCode ?? row.flowDesc ?? "").toUpperCase()
    if (!byYear.has(year)) byYear.set(year, {})
    const bucket = byYear.get(year)!
    if (code === "X" || code === "2" || /EXPORT/.test(code)) bucket.exports = value
    else if (code === "M" || code === "1" || /IMPORT/.test(code)) bucket.imports = value
  }

  // Pick the most recent year that has BOTH legs.
  const sortedYears = Array.from(byYear.keys()).sort((a, b) => b - a)
  let chosenYear: number | null = null
  for (const y of sortedYears) {
    const b = byYear.get(y)!
    if (b.exports != null && b.imports != null) {
      chosenYear = y
      break
    }
  }
  if (chosenYear == null) return []
  const { exports, imports } = byYear.get(chosenYear)!
  const datetime = new Date(Date.UTC(chosenYear, 0, 1))

  return [
    {
      sourceCode: COMTRADE_SOURCE,
      metric: "AZ_GOODS_EXPORTS_USD",
      datetime,
      value: Math.round(exports!),
      unit: "USD",
      raw: { year: chosenYear, flowCode: "X" },
    },
    {
      sourceCode: COMTRADE_SOURCE,
      metric: "AZ_GOODS_IMPORTS_USD",
      datetime,
      value: Math.round(imports!),
      unit: "USD",
      raw: { year: chosenYear, flowCode: "M" },
    },
    {
      sourceCode: COMTRADE_SOURCE,
      metric: "AZ_TRADE_BALANCE_USD",
      datetime,
      value: Math.round(exports! - imports!),
      unit: "USD",
      raw: { year: chosenYear, derived: true },
    },
  ]
}

export function createUnComtradeAzAdapter(
  opts: CommodityAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: COMTRADE_SOURCE,
    label: COMTRADE_LABEL,
    async fetch(now: Date = new Date()): Promise<CommodityFetchResult> {
      const url = buildComtradeUrl(now)
      let response: Response
      try {
        response = await fetchImpl(url)
      } catch (e) {
        return {
          source: COMTRADE_SOURCE,
          dataPoints: [],
          errors: [`fetch failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: false,
        }
      }
      if (!response.ok) {
        return {
          source: COMTRADE_SOURCE,
          dataPoints: [],
          errors: [`HTTP ${response.status} from Comtrade`],
          fetched: true,
        }
      }
      let parsed: ComtradeResponse
      try {
        parsed = (await response.json()) as ComtradeResponse
      } catch (e) {
        return {
          source: COMTRADE_SOURCE,
          dataPoints: [],
          errors: [`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: true,
        }
      }
      const dataPoints = comtradeResponseToDataPoints(parsed)
      const errors: string[] = []
      if (dataPoints.length === 0) {
        errors.push(
          "Comtrade returned no year with both exports + imports (publishing lag is normal — re-check next month)",
        )
      }
      return { source: COMTRADE_SOURCE, dataPoints, errors, fetched: true }
    },
  }
}

export const UN_COMTRADE_AZ_SOURCE = COMTRADE_SOURCE
