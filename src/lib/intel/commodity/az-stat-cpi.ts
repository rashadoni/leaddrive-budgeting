/**
 * Phase 7.K — AZ State Statistics CPI breakdown adapter (xlsx).
 *
 * stat.gov.az publishes CPI as **Excel only** (no CSV / API). This
 * adapter fetches their monthly CPI index workbook + parses 4 sector-
 * indexed series with the `xlsx` library, then computes YoY% change
 * (this-month vs same-month-prior-year) for the latest reported month
 * — that's the form the indicator thresholds expect.
 *
 * **Sectors served**: retail (food CPI), beverage (food CPI),
 * food_processing (input-cost pass-through), services
 * (services CPI = labor + lease pass-through).
 *
 * **Source file**: stat.gov.az `001_2en.xlsx` — "Consumer Price Index
 * (2010=100, monthly)". Columns: B=Total, C=Food, D=Non-food,
 * E=Paid services. Row layout: year-only rows (e.g. `2019`) followed
 * by 12 Roman-numeral month rows (I, II, ..., XII).
 *
 * URL is **configurable per-org** via `opts.xlsxUrl` — stat.gov.az
 * historically renames files mid-year so an admin override is the
 * safe forward path.
 *
 * **Cadence**: monthly. Latest month anchored to UTC 1st-of-month.
 *
 * **Metrics emitted** (each YoY% so seed thresholds at ≤105/≤115/>115
 * remain meaningful):
 *   AZ_CPI_ALL_ITEMS    — total CPI YoY%
 *   AZ_CPI_FOOD         — food + beverage + tobacco YoY%
 *   AZ_CPI_NON_FOOD     — non-food consumer goods YoY%
 *   AZ_CPI_SERVICES     — paid services YoY%
 *
 * Housing/utilities NOT in 001_2en — `AZ_CPI_HOUSING` indicator stays
 * unknown until we wire a separate source (or fall back to services).
 */
import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityFetchResult,
  CommodityDataPoint,
} from "./types"
import * as XLSX from "xlsx"

const AZ_CPI_SOURCE = "az-stat-cpi"
const AZ_CPI_LABEL = "AZ State Statistics CPI (xlsx)"

/** Stable stat.gov.az path (verified 2026-05-17). Admin override
 *  via `Organization.settings.intelSourceUrls['az-stat-cpi']` is the
 *  forward path when stat.gov.az rotates the filename. */
const DEFAULT_XLSX_URL =
  "https://www.stat.gov.az/source/price_tarif/en/001_2en.xlsx"

/** Column-name to emitted-metric map. Sheet 001_2en uses these exact
 *  English captions in the header (rows 2-3). */
const COLUMN_TO_METRIC: Record<string, string> = {
  "Total goods and services": "AZ_CPI_ALL_ITEMS",
  "Total goods and serviсes": "AZ_CPI_ALL_ITEMS", // Cyrillic с typo in actual file
  "Food products, beverages and tobacco products": "AZ_CPI_FOOD",
  "Non-food products": "AZ_CPI_NON_FOOD",
  "Paid services": "AZ_CPI_SERVICES",
}

/** Roman numeral → month-of-year. AZ stat uses lowercase + Cyrillic
 *  variants occasionally, so accept multiple forms. */
const ROMAN_TO_MONTH: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6,
  vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
}

interface AzCpiAdapterOptions extends CommodityAdapterOptions {
  /** Override stat.gov.az xlsx URL. */
  xlsxUrl?: string
}

interface ParsedRow {
  year: number
  month: number
  /** Map of metric code → CPI index value (base 2010=100). */
  values: Partial<Record<string, number>>
}

/**
 * Parse the workbook arrayBuffer → array of monthly rows with
 * per-metric values. Pure helper for tests.
 */
export function parseAzCpiXlsx(buffer: ArrayBuffer | Uint8Array): ParsedRow[] {
  // Tolerate both array-buffer-style (browsers / fetch.arrayBuffer()) and
  // Uint8Array (node tests with Buffer).
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const wb = XLSX.read(bytes, { type: "array" })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
  })

  // 1. Find header band (1 or 2 adjacent rows) containing column
  //    captions. stat.gov.az frequently splits captions across two
  //    rows ("of which" parent row + sub-category row underneath).
  //    We walk windows of (i, i+1) and merge captions from both.
  const collectCaptions = (row: unknown[] | undefined): Record<string, number> => {
    const hits: Record<string, number> = {}
    if (!Array.isArray(row)) return hits
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]
      if (typeof cell !== "string") continue
      const trimmed = cell.trim()
      for (const [caption, metric] of Object.entries(COLUMN_TO_METRIC)) {
        if (trimmed === caption.trim()) {
          hits[metric] = c
        }
      }
    }
    return hits
  }
  // Strategy: find the FIRST row that contains at least one caption,
  // then absorb captions from its immediate successor too (real file
  // splits captions across 2 rows where row N has "Total" + "of which"
  // parent column and row N+1 has the sub-category names underneath).
  // We require `here.length > 0` (not just merged) so we don't break
  // prematurely on an empty header row that happens to be followed by
  // a captioned sub-header.
  let headerRowIdx = -1
  let columnIndexByMetric: Record<string, number> = {}
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const here = collectCaptions(rows[i])
    if (Object.keys(here).length === 0) continue
    const next = collectCaptions(rows[i + 1])
    const merged: Record<string, number> = { ...here }
    for (const [k, v] of Object.entries(next)) {
      if (merged[k] === undefined) merged[k] = v
    }
    headerRowIdx = Object.keys(next).length > 0 ? i + 1 : i
    columnIndexByMetric = merged
    break
  }
  if (headerRowIdx < 0) return []

  // 2. Walk data rows. Track current year; emit one ParsedRow per month.
  const out: ParsedRow[] = []
  let currentYear: number | null = null
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!Array.isArray(row) || row.length === 0) continue
    const first = row[0]
    // Year-only row: e.g. `2019` as a number, OR string "2019".
    if (typeof first === "number" && first >= 1990 && first <= 2099) {
      currentYear = first
      continue
    }
    if (typeof first === "string") {
      const trimmed = first.trim()
      const yearGuess = Number(trimmed)
      if (Number.isFinite(yearGuess) && yearGuess >= 1990 && yearGuess <= 2099) {
        currentYear = yearGuess
        continue
      }
      // Roman-numeral month row.
      const month = ROMAN_TO_MONTH[trimmed.toLowerCase()]
      if (month && currentYear) {
        const values: Partial<Record<string, number>> = {}
        for (const [metric, colIdx] of Object.entries(columnIndexByMetric)) {
          const cell = row[colIdx]
          const numeric = typeof cell === "number" ? cell : Number(cell)
          if (Number.isFinite(numeric)) values[metric] = numeric
        }
        if (Object.keys(values).length > 0) {
          out.push({ year: currentYear, month, values })
        }
      }
    }
  }
  return out
}

/**
 * From parsed monthly rows, emit per-metric YoY% data points anchored
 * to the LATEST month's UTC 1st-of-month. YoY% = latest / same-month-
 * prior-year × 100 (so value 105 means +5% YoY).
 *
 * If no prior-year sibling row exists for a metric (early data), that
 * metric is skipped — caller logs the partial result.
 */
export function rowsToYoYDataPoints(rows: ParsedRow[]): CommodityDataPoint[] {
  if (rows.length === 0) return []
  // Sort ascending by (year, month).
  rows.sort((a, b) => a.year - b.year || a.month - b.month)
  const latest = rows[rows.length - 1]
  const out: CommodityDataPoint[] = []
  for (const [metric, latestValue] of Object.entries(latest.values)) {
    if (typeof latestValue !== "number" || !Number.isFinite(latestValue)) continue
    // Find prior-year same-month row.
    const prior = rows.find(
      (r) => r.year === latest.year - 1 && r.month === latest.month,
    )
    const priorValue = prior?.values[metric]
    if (typeof priorValue !== "number" || !Number.isFinite(priorValue) || priorValue === 0) {
      continue
    }
    const yoy = Math.round((latestValue / priorValue) * 10000) / 100 // % with 2dp
    out.push({
      sourceCode: AZ_CPI_SOURCE,
      metric,
      datetime: new Date(Date.UTC(latest.year, latest.month - 1, 1)),
      value: yoy,
      unit: "% YoY",
      raw: {
        latestIndex: latestValue,
        priorYearIndex: priorValue,
        latestYearMonth: `${latest.year}-${String(latest.month).padStart(2, "0")}`,
      },
    })
  }
  return out
}

export function createAzStatCpiAdapter(
  opts: AzCpiAdapterOptions = {},
): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  const xlsxUrl = opts.xlsxUrl ?? DEFAULT_XLSX_URL
  return {
    source: AZ_CPI_SOURCE,
    label: AZ_CPI_LABEL,
    async fetch(): Promise<CommodityFetchResult> {
      let response: Response
      try {
        response = await fetchImpl(xlsxUrl)
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
          errors: [`HTTP ${response.status} from ${xlsxUrl}`],
          fetched: true,
        }
      }
      let buffer: ArrayBuffer
      try {
        buffer = await response.arrayBuffer()
      } catch (e) {
        return {
          source: AZ_CPI_SOURCE,
          dataPoints: [],
          errors: [`body read failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: true,
        }
      }
      let rows: ParsedRow[]
      try {
        rows = parseAzCpiXlsx(buffer)
      } catch (e) {
        return {
          source: AZ_CPI_SOURCE,
          dataPoints: [],
          errors: [`xlsx parse failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: true,
        }
      }
      if (rows.length === 0) {
        return {
          source: AZ_CPI_SOURCE,
          dataPoints: [],
          errors: [
            "XLSX produced 0 mappable rows — stat.gov.az may have changed format or our header captions are stale",
          ],
          fetched: true,
        }
      }
      const dataPoints = rowsToYoYDataPoints(rows)
      const errors: string[] = []
      if (dataPoints.length === 0) {
        errors.push(
          "No YoY comparison possible — latest month has no prior-year sibling row",
        )
      }
      return { source: AZ_CPI_SOURCE, dataPoints, errors, fetched: true }
    },
  }
}

export const AZ_STAT_CPI_SOURCE = AZ_CPI_SOURCE
