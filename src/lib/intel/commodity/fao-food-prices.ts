/**
 * Phase 7.K — FAO Food Price Index adapter.
 *
 * Replaces the broken `worldbank-sugar` adapter (Pink Sheet was a
 * monthly Excel file at a shifting URL). FAO publishes a monthly Food
 * Price Index broken down by 5 commodity baskets (Meat, Dairy,
 * Cereals, Vegetable Oils, Sugar) as a stable CSV at:
 *
 *   https://www.fao.org/worldfoodsituation/foodpricesindex/en/
 *     (the page links to: https://www.fao.org/worldfoodsituation/.stat/.../FoodPriceIndex.xlsx)
 *
 * For v1 we use the **CSV variant** maintained at the same path
 * (FAO's "Real Food Price Index" CSV). If FAO removes the CSV we fall
 * back to scraping the HTML page's data-table; v1 keeps it simple.
 *
 * **Auth**: none (public).
 * **Cadence**: monthly (FAO publishes first Friday of each month).
 * **Metrics**:
 *   FAO_FFPI_NOMINAL      — overall food price index (nominal, base 2014-2016=100)
 *   FAO_MEAT_INDEX        — meat sub-index
 *   FAO_DAIRY_INDEX       — dairy sub-index
 *   FAO_CEREAL_INDEX      — cereals
 *   FAO_OILS_INDEX        — vegetable oils
 *   FAO_SUGAR_INDEX       — sugar (replaces worldbank-sugar)
 *
 * Output anchored to 1st-of-month UTC for idempotency.
 */
import type {
  CommodityAdapter,
  CommodityAdapterOptions,
  CommodityFetchResult,
  CommodityDataPoint,
} from "./types"

const FAO_SOURCE = "fao-food-prices"
const FAO_LABEL = "FAO Food Price Index"

/** FAO maintains the CSV at this stable path. If it 404s, the
 *  scheduler will surface the error in the Drift Dashboard and admin
 *  can re-check FAO's page for a new URL.
 *
 *  2026-05-17 update: FAO migrated their CDN. Previous URL was
 *  /fileadmin/templates/worldfood/Reports_and_docs/Food_price_indices_data_dec.csv;
 *  new URL is /media/docs/worldfoodsituationlibraries/.... If they
 *  migrate again, admin should pull the latest from
 *  https://www.fao.org/worldfoodsituation/foodpricesindex/en/ and
 *  override via a config setting. */
const FAO_CSV_URL =
  "https://www.fao.org/media/docs/worldfoodsituationlibraries/default-document-library/food_price_indices_data.csv"

interface FaoCsvRow {
  year: number
  month: number
  ffpi: number | null
  meat: number | null
  dairy: number | null
  cereal: number | null
  oils: number | null
  sugar: number | null
}

/** Parse the FAO CSV — first 4 lines are header, then rows of
 *  `Date, FFPI, Meat, Dairy, Cereals, Oils, Sugar` where Date is
 *  "Jan 2014" / "Feb 2014" / ... Pure helper so tests feed canned CSV. */
export function parseFaoCsv(csv: string): FaoCsvRow[] {
  const rows: FaoCsvRow[] = []
  const lines = csv.split(/\r?\n/)
  const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  }
  /** CSV-aware split: respects double-quoted cells (which may contain
   *  commas like "1,250.4"). Naive `split(",")` breaks on those. */
  const splitCsvLine = (line: string): string[] => {
    const cells: string[] = []
    let cur = ""
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        inQuote = !inQuote
        continue
      }
      if (ch === "," && !inQuote) {
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
    const cols = splitCsvLine(line)
    if (cols.length < 7) continue
    const dateCol = cols[0]
    // Support two FAO date formats:
    //   Legacy (pre-2026-05): "Jan 2026" / "May 2026" — month-word + year
    //   Current (2026-05+):   "2026-01" / "2026-05" — ISO YYYY-MM
    let month: number | undefined
    let year: number = NaN
    const mNamed = /^([A-Za-z]+)\s+(\d{4})$/.exec(dateCol)
    const mIso = /^(\d{4})-(\d{1,2})$/.exec(dateCol)
    if (mNamed) {
      month = MONTHS[mNamed[1].slice(0, 3).toLowerCase()]
      year = Number(mNamed[2])
    } else if (mIso) {
      year = Number(mIso[1])
      const mNum = Number(mIso[2])
      if (mNum >= 1 && mNum <= 12) month = mNum
    } else {
      continue
    }
    if (!month || !Number.isFinite(year)) continue
    const parseCell = (s: string): number | null => {
      // Strip thousand separators (commas) — inside quotes they
      // survived splitCsvLine; outside quotes they were column
      // delimiters and already split.
      const n = Number(s.replace(/,/g, ""))
      return Number.isFinite(n) ? n : null
    }
    rows.push({
      year,
      month,
      ffpi: parseCell(cols[1]),
      meat: parseCell(cols[2]),
      dairy: parseCell(cols[3]),
      cereal: parseCell(cols[4]),
      oils: parseCell(cols[5]),
      sugar: parseCell(cols[6]),
    })
  }
  return rows
}

/** Emit one CommodityDataPoint per sub-index for the latest row in the
 *  CSV. Anchors datetime to UTC start-of-month for idempotency. */
export function faoRowToDataPoints(row: FaoCsvRow): CommodityDataPoint[] {
  const datetime = new Date(Date.UTC(row.year, row.month - 1, 1))
  const out: CommodityDataPoint[] = []
  const map: Array<[keyof FaoCsvRow, string]> = [
    ["ffpi", "FAO_FFPI_NOMINAL"],
    ["meat", "FAO_MEAT_INDEX"],
    ["dairy", "FAO_DAIRY_INDEX"],
    ["cereal", "FAO_CEREAL_INDEX"],
    ["oils", "FAO_OILS_INDEX"],
    ["sugar", "FAO_SUGAR_INDEX"],
  ]
  for (const [field, metric] of map) {
    const value = row[field]
    if (typeof value !== "number" || !Number.isFinite(value)) continue
    out.push({
      sourceCode: FAO_SOURCE,
      metric,
      datetime,
      value,
      unit: "index",
      raw: { period: `${row.year}-${String(row.month).padStart(2, "0")}` },
    })
  }
  return out
}

export function createFAOFoodPricesAdapter(opts: CommodityAdapterOptions = {}): CommodityAdapter {
  const fetchImpl = opts.fetchImpl ?? fetch
  return {
    source: FAO_SOURCE,
    label: FAO_LABEL,
    async fetch(): Promise<CommodityFetchResult> {
      let response: Response
      try {
        response = await fetchImpl(FAO_CSV_URL)
      } catch (e) {
        return {
          source: FAO_SOURCE,
          dataPoints: [],
          errors: [`fetch failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: false,
        }
      }
      if (!response.ok) {
        return {
          source: FAO_SOURCE,
          dataPoints: [],
          errors: [`HTTP ${response.status} from ${FAO_CSV_URL}`],
          fetched: true,
        }
      }
      let csv: string
      try {
        csv = await response.text()
      } catch (e) {
        return {
          source: FAO_SOURCE,
          dataPoints: [],
          errors: [`response body read failed: ${e instanceof Error ? e.message : String(e)}`],
          fetched: true,
        }
      }
      const rows = parseFaoCsv(csv)
      if (rows.length === 0) {
        return {
          source: FAO_SOURCE,
          dataPoints: [],
          errors: ["CSV produced 0 parseable rows — FAO may have changed format"],
          fetched: true,
        }
      }
      // Latest row = max (year, month)
      const latest = rows.reduce((a, b) =>
        a.year > b.year || (a.year === b.year && a.month > b.month) ? a : b,
      )
      const dataPoints = faoRowToDataPoints(latest)
      const errors: string[] = []
      if (dataPoints.length === 0) {
        errors.push("Latest CSV row had no numeric values across all 6 sub-indices")
      }
      return { source: FAO_SOURCE, dataPoints, errors, fetched: true }
    },
  }
}

export const FAO_FOOD_PRICES_SOURCE = FAO_SOURCE
