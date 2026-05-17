/**
 * Phase 7.K — AZ State Statistics CPI breakdown adapter.
 *
 * AZ CPI is published by **stat.gov.az** monthly, broken down by
 * 5 categories: All-items, Food, Non-food (consumer goods), Services,
 * and Housing/Utilities (the last derived as services × shelter sub-
 * index). World Bank's WB_INFL gives only the All-items aggregate; this
 * adapter adds the category granularity needed by sector indicators.
 *
 * **Sectors served**: retail (food CPI = consumer affordability),
 * beverage (food CPI = consumer goods demand), real_estate
 * (housing CPI = rent pressure), logistics (transport sub-index =
 * fuel pass-through), food_processing (food CPI = pricing power).
 *
 * **Source**: stat.gov.az open-data — they publish monthly Excel + CSV
 * exports. The exact URL is **configurable per-org** via
 * `opts.csvUrl` because the path changes from year to year (stat.gov.az
 * does not version the URL — they overwrite `iqp_<year>.csv`). Default
 * URL points to the current-year CSV; admin can override.
 *
 * **Cadence**: monthly (~14th of the following month). Anchored to UTC
 * 1st-of-month for idempotency.
 *
 * **Format** (4-column CSV after header):
 *   category, year, month, value
 *   "Food", 2026, 1, 102.4
 *   "Food", 2026, 2, 103.1
 *   "All-items", 2026, 1, 101.8
 *   ...
 *
 * **Graceful degradation**: if the CSV URL 404s or returns 0 parseable
 * rows, the adapter logs an error but doesn't throw. The drift dashboard
 * shows it as STALE rather than crashing the scheduler.
 *
 * **Metrics emitted** (mapped from CSV category names):
 *   AZ_CPI_ALL_ITEMS    — overall CPI index (base 2020=100)
 *   AZ_CPI_FOOD         — food sub-index
 *   AZ_CPI_NON_FOOD     — non-food consumer goods sub-index
 *   AZ_CPI_SERVICES     — services sub-index
 *   AZ_CPI_HOUSING      — housing+utilities sub-index (where reported)
 *
 * Unknown categories in the CSV are silently dropped (forward-compatible
 * with stat.gov.az adding new breakdowns).
 */

import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityDataPoint,
  CommodityFetchResult,
} from "./types"

const AZ_CPI_SOURCE = "az-stat-cpi"
const AZ_CPI_LABEL = "AZ State Statistics CPI (category breakdown)"

/** Default CSV URL — pointed at the current-year stat.gov.az
 *  redistribution. Override via `opts.csvUrl` if the path changes. */
const DEFAULT_CSV_URL = "https://www.stat.gov.az/source/price/cpi_monthly.csv"

interface AzCpiAdapterOptions extends CommodityAdapterOptions {
  /** Override the default stat.gov.az CSV URL. */
  csvUrl?: string
}

/**
 * Map of CSV category text → emitted metric name. Case-insensitive.
 * Recognises both English + AZ-cyrillic spellings + a few alternates.
 */
export const AZ_CPI_CATEGORY_MAP: Record<string, string> = {
  "all-items": "AZ_CPI_ALL_ITEMS",
  "all items": "AZ_CPI_ALL_ITEMS",
  total: "AZ_CPI_ALL_ITEMS",
  "ümumi": "AZ_CPI_ALL_ITEMS",
  food: "AZ_CPI_FOOD",
  "ərzaq": "AZ_CPI_FOOD",
  "non-food": "AZ_CPI_NON_FOOD",
  "non food": "AZ_CPI_NON_FOOD",
  "qeyri-ərzaq": "AZ_CPI_NON_FOOD",
  services: "AZ_CPI_SERVICES",
  xidmət: "AZ_CPI_SERVICES",
  housing: "AZ_CPI_HOUSING",
  utilities: "AZ_CPI_HOUSING",
  mənzil: "AZ_CPI_HOUSING",
}

interface CpiRow {
  category: string
  metric: string
  year: number
  month: number
  value: number
}

/**
 * Parse the CSV. Pure helper so tests feed canned data. Accepts either
 * comma- or semicolon-separated, handles quoted cells.
 */
export function parseAzCpiCsv(csv: string): CpiRow[] {
  const lines = csv.split(/\r?\n/)
  const rows: CpiRow[] = []
  const splitLine = (line: string): string[] => {
    const cells: string[] = []
    let cur = ""
    let inQuote = false
    // Auto-detect delimiter on first row: comma or semicolon
    const delim = line.includes(";") && !line.includes(",") ? ";" : ","
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        inQuote = !inQuote
        continue
      }
      if (ch === delim && !inQuote) {
        cells.push(cur)
        cur = ""
        continue
      }
      cur += ch
    }
    cells.push(cur)
    return cells.map((c) => c.trim())
  }
  for (const line of lines) {
    if (!line.trim()) continue
    const cols = splitLine(line)
    if (cols.length < 4) continue
    const [rawCategory, rawYear, rawMonth, rawValue] = cols
    const categoryKey = rawCategory.toLowerCase()
    const metric = AZ_CPI_CATEGORY_MAP[categoryKey]
    if (!metric) continue
    const year = Number(rawYear)
    const month = Number(rawMonth)
    const value = Number(rawValue.replace(/,/g, "."))
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(value) ||
      month < 1 ||
      month > 12
    ) {
      continue
    }
    rows.push({ category: rawCategory, metric, year, month, value })
  }
  return rows
}

/**
 * Convert rows → data points. Emits one point per (metric, year, month)
 * anchored to UTC 1st-of-month.
 */
export function azCpiRowsToDataPoints(rows: CpiRow[]): CommodityDataPoint[] {
  return rows.map((r) => ({
    sourceCode: AZ_CPI_SOURCE,
    metric: r.metric,
    datetime: new Date(Date.UTC(r.year, r.month - 1, 1)),
    value: r.value,
    unit: "index",
    raw: { category: r.category, year: r.year, month: r.month },
  }))
}

export function createAzStatCpiAdapter(
  opts: AzCpiAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  const csvUrl = opts.csvUrl ?? DEFAULT_CSV_URL
  return {
    source: AZ_CPI_SOURCE,
    label: AZ_CPI_LABEL,
    async fetch(): Promise<CommodityFetchResult> {
      let response: Response
      try {
        response = await fetchImpl(csvUrl)
      } catch (e) {
        return {
          source: AZ_CPI_SOURCE,
          dataPoints: [],
          errors: [`fetch failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: false,
        }
      }
      if (!response.ok) {
        return {
          source: AZ_CPI_SOURCE,
          dataPoints: [],
          errors: [`HTTP ${response.status} from ${csvUrl}`],
          fetched: true,
        }
      }
      let csv: string
      try {
        csv = await response.text()
      } catch (e) {
        return {
          source: AZ_CPI_SOURCE,
          dataPoints: [],
          errors: [`body read failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: true,
        }
      }
      const rows = parseAzCpiCsv(csv)
      if (rows.length === 0) {
        return {
          source: AZ_CPI_SOURCE,
          dataPoints: [],
          errors: [
            `CSV produced 0 mappable rows — stat.gov.az may have changed format or our category map is stale`,
          ],
          fetched: true,
        }
      }
      const dataPoints = azCpiRowsToDataPoints(rows)
      return {
        source: AZ_CPI_SOURCE,
        dataPoints,
        errors: [],
        fetched: true,
      }
    },
  }
}

export const AZ_STAT_CPI_SOURCE = AZ_CPI_SOURCE
