/**
 * Phase 7.K — EIA Energy Adapter.
 *
 * Replaces the broken `commodities-rss-brent` adapter. EIA (US Energy
 * Information Administration) publishes free official daily/weekly
 * prices for Brent crude, WTI, Henry Hub natural gas, and US retail
 * gasoline via the v2 API:
 *
 *   https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=<KEY>&data[0]=value&facets[product][]=EPCBRENT&...
 *
 * **Auth**: free API key required (registration at api.eia.gov).
 * **Cadence**: daily for crude/gas (EIA publishes mid-afternoon US
 * Eastern); weekly for retail. v1 reads spot via `petroleum/pri/spt`
 * series.
 *
 * Per-org key storage: helper reads `Organization.settings.apiKeys.eia`
 * (Phase 5a). Adapter accepts `apiKey` in options; if null, returns
 * empty `dataPoints` + error `"api_key_missing"` (graceful degradation).
 *
 * Metrics emitted:
 *   BRENT_USD_BBL       — Brent crude spot, USD/barrel
 *   WTI_USD_BBL         — WTI crude spot
 *   NATGAS_USD_MMBTU    — Henry Hub natural gas, USD/MMBtu
 */
import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityFetchResult,
  CommodityDataPoint,
} from "./types"

const EIA_SOURCE = "eia-energy"
const EIA_LABEL = "EIA Energy (Brent / WTI / NatGas)"
const EIA_BASE_URL = "https://api.eia.gov/v2"

interface EiaAdapterOptions extends CommodityAdapterOptions {
  /** Per-org EIA API key (loaded from Organization.settings.apiKeys.eia
   *  by the scheduler factory). When undefined the adapter returns
   *  empty + `api_key_missing` error — no fetch attempted. */
  apiKey?: string | null
}

/** Catalog of EIA series to pull each run. EIA's v2 API uses route
 *  hierarchy + facets to identify a series. To add a new metric add a
 *  row here. */
interface EiaSeries {
  metric: string
  unit: string
  /** Route hierarchy under /v2/. */
  route: string
  /** Facet filter — typically `product` for petroleum or `series` for nat-gas. */
  facets: Record<string, string>
}
const EIA_SERIES: readonly EiaSeries[] = [
  {
    metric: "BRENT_USD_BBL",
    unit: "USD/bbl",
    route: "petroleum/pri/spt/data",
    facets: { product: "EPCBRENT" },
  },
  {
    metric: "WTI_USD_BBL",
    unit: "USD/bbl",
    route: "petroleum/pri/spt/data",
    facets: { product: "EPCWTI" },
  },
  {
    metric: "NATGAS_USD_MMBTU",
    unit: "USD/MMBtu",
    route: "natural-gas/pri/fut/data",
    facets: { series: "RNGC1" },
  },
]

/** EIA v2 wraps every series in `{ response: { data: [...] } }`. Pure
 *  helper so tests can feed canned JSON. */
interface EiaResponse {
  response?: {
    data?: Array<{ period?: string; value?: number | string }>
  }
}

export function eiaResponseToDataPoint(
  res: EiaResponse,
  series: EiaSeries,
): CommodityDataPoint | null {
  const rows = res.response?.data
  if (!Array.isArray(rows) || rows.length === 0) return null
  // EIA's `data` array is sorted newest-first by default — but to be safe
  // we pick the row with the latest `period` (ISO date string).
  let latest = rows[0]
  for (const r of rows) {
    if (!latest.period || (r.period && r.period > latest.period)) latest = r
  }
  const valueRaw = latest.value
  const value = typeof valueRaw === "number" ? valueRaw : Number(valueRaw)
  if (!Number.isFinite(value)) return null
  if (!latest.period) return null
  // EIA periods come in different shapes (YYYY-MM-DD daily, YYYY-MM
  // monthly, YYYY-Www weekly). We parse as the start of that period.
  const datetime = new Date(latest.period.length === 7 ? `${latest.period}-01` : latest.period)
  if (isNaN(datetime.getTime())) return null
  return {
    sourceCode: EIA_SOURCE,
    metric: series.metric,
    datetime,
    value,
    unit: series.unit,
    raw: { period: latest.period, route: series.route },
  }
}

function buildEiaUrl(series: EiaSeries, apiKey: string): string {
  const params = new URLSearchParams({
    api_key: apiKey,
    "data[0]": "value",
    "sort[0][column]": "period",
    "sort[0][direction]": "desc",
    length: "1", // we only need the latest row
  })
  for (const [facet, val] of Object.entries(series.facets)) {
    params.append(`facets[${facet}][]`, val)
  }
  return `${EIA_BASE_URL}/${series.route}?${params.toString()}`
}

export function createEIAEnergyAdapter(opts: EiaAdapterOptions = {}): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  const apiKey = opts.apiKey ?? null
  return {
    source: EIA_SOURCE,
    label: EIA_LABEL,
    async fetch(): Promise<CommodityFetchResult> {
      if (!apiKey) {
        return {
          source: EIA_SOURCE,
          dataPoints: [],
          errors: ["api_key_missing — set Organization.settings.apiKeys.eia via /budgeting/admin/api-keys"],
          fetched: false,
        }
      }
      const dataPoints: CommodityDataPoint[] = []
      const errors: string[] = []
      for (const series of EIA_SERIES) {
        const url = buildEiaUrl(series, apiKey)
        let response: Response
        try {
          response = await fetchImpl(url)
        } catch (e) {
          errors.push(`${series.metric}: fetch failed: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        if (!response.ok) {
          errors.push(`${series.metric}: HTTP ${response.status}`)
          continue
        }
        let parsed: EiaResponse
        try {
          parsed = (await response.json()) as EiaResponse
        } catch (e) {
          errors.push(`${series.metric}: JSON parse: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        const point = eiaResponseToDataPoint(parsed, series)
        if (point) {
          dataPoints.push(point)
        } else {
          errors.push(`${series.metric}: no valid row in response`)
        }
      }
      return { source: EIA_SOURCE, dataPoints, errors, fetched: true }
    },
  }
}

export const EIA_ENERGY_SOURCE = EIA_SOURCE
