/**
 * Phase 7.K — World Bank Indicators adapter for tourism + education.
 *
 * Companion to `worldbank-cpi` — uses the same WB Open Data API but
 * pulls different indicators relevant to non-agro sectors.
 *
 * **Sectors served**: hospitality (tourism arrivals + receipts drives
 * hotel occupancy), education (school enrollment + age cohort drives
 * student demand), entertainment (tourism = audience size).
 *
 * **Indicators** (all AZ; codes are WB standard):
 *   ST.INT.ARVL       → International tourism, arrivals (#)
 *   ST.INT.RCPT.CD    → International tourism receipts (USD)
 *   ST.INT.XPND.CD    → International tourism expenditures (USD)
 *   SE.SEC.ENRR       → Secondary school enrollment (% gross)
 *   SE.XPD.TOTL.GD.ZS → Govt education spending (% of GDP)
 *   SP.POP.0014.TO.ZS → Population ages 0-14 (% — student cohort)
 *
 * **Cadence**: annual (data lags 1-2 years for tourism, 1-3y for
 * education). Anchored to UTC Jan-1 of reported year. Idempotent via
 * the unique constraint.
 *
 * **Per-indicator isolation**: same as eia-energy.
 */

import { OUTBOUND_FETCH_INIT } from "./outbound-agent"
import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"

const WB_SOURCE = "wb-indicators"
const WB_LABEL = "World Bank Indicators (tourism + education AZ)"

const AZ_COUNTRY = "AZ"

interface WBIndicator {
  metric: string
  unit: string
  wbCode: string
}

export const WB_INDICATORS: readonly WBIndicator[] = [
  {
    metric: "AZ_TOURISM_ARRIVALS",
    unit: "persons",
    wbCode: "ST.INT.ARVL",
  },
  {
    metric: "AZ_TOURISM_RECEIPTS_USD",
    unit: "USD",
    wbCode: "ST.INT.RCPT.CD",
  },
  {
    metric: "AZ_TOURISM_EXPENDITURES_USD",
    unit: "USD",
    wbCode: "ST.INT.XPND.CD",
  },
  {
    metric: "AZ_SCHOOL_ENROLL_SEC_PCT",
    unit: "%",
    wbCode: "SE.SEC.ENRR",
  },
  {
    metric: "AZ_EDU_EXPENDITURE_PCT_GDP",
    unit: "%",
    wbCode: "SE.XPD.TOTL.GD.ZS",
  },
  {
    metric: "AZ_POP_AGE_0_14_PCT",
    unit: "%",
    wbCode: "SP.POP.0014.TO.ZS",
  },
]

interface WBDataPoint {
  date?: string
  value?: number | null
}

type WBResponse = [unknown, WBDataPoint[]] | unknown

/**
 * Convert WB response + indicator config → latest data point.
 * "Latest" = most recent year with a non-null value (WB returns
 * many years with the tail often null while reporting catches up).
 */
export function wbIndicatorResponseToDataPoint(
  response: WBResponse,
  indicator: WBIndicator,
): CommodityDataPoint | null {
  if (!Array.isArray(response) || response.length < 2) return null
  const data = response[1] as WBDataPoint[]
  if (!Array.isArray(data) || data.length === 0) return null

  let best: { year: number; value: number } | null = null
  for (const row of data) {
    const year = Number(row.date)
    const value = row.value
    if (!Number.isFinite(year) || typeof value !== "number" || !Number.isFinite(value)) {
      continue
    }
    if (!best || year > best.year) best = { year, value }
  }
  if (!best) return null
  return {
    sourceCode: WB_SOURCE,
    metric: indicator.metric,
    datetime: new Date(Date.UTC(best.year, 0, 1)),
    value: best.value,
    unit: indicator.unit,
    raw: { year: best.year, wbCode: indicator.wbCode },
  }
}

function wbUrl(indicator: WBIndicator): string {
  // Date range 2018:current; WB will return all annual rows including
  // nulls at the tail, helper picks the latest non-null.
  const endYear = new Date().getUTCFullYear()
  return (
    `https://api.worldbank.org/v2/country/${AZ_COUNTRY}/indicator/${indicator.wbCode}` +
    `?format=json&date=2018:${endYear}&per_page=100`
  )
}

export function createWbIndicatorsAdapter(
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
      for (const indicator of WB_INDICATORS) {
        let response: Response
        try {
          response = await fetchImpl(wbUrl(indicator), OUTBOUND_FETCH_INIT)
        } catch (e) {
          errors.push(
            `${indicator.metric}: fetch failed: ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        anyFetched = true
        if (!response.ok) {
          errors.push(`${indicator.metric}: HTTP ${response.status}`)
          continue
        }
        let parsed: WBResponse
        try {
          parsed = (await response.json()) as WBResponse
        } catch (e) {
          errors.push(
            `${indicator.metric}: JSON parse failed: ${e instanceof Error ? e.message : String(e)}`,
          )
          continue
        }
        const point = wbIndicatorResponseToDataPoint(parsed, indicator)
        if (!point) {
          errors.push(`${indicator.metric}: no non-null annual rows in WB response`)
          continue
        }
        allPoints.push(point)
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

export const WB_INDICATORS_SOURCE = WB_SOURCE
