/**
 * Phase 7.M Tier 4 (2026-05-19) — Farming Strategy parser.
 *
 * Parses key forward-looking sheets from "Farming strategy - Guvven.xlsx":
 *
 *   • İcmal   — consolidated forward revenue (2026-2035 + Terminal) per
 *               Business Unit (Buğda / Şəkər çuğunduru / Qarğıdalı /
 *               Pambıq / Arpa / Torpaq icarəsi / Lab services etc.)
 *   • Sales plan — per-product forward sales VOLUMES 2027-2032 for CPC
 *
 * Output is structured for storage on `Company.settings.forwardForecast`
 * (no DB schema change). Risk Terminal Panel 4 reads this for the
 * 2027-2028 forecast view + AI Variance Explainer references it.
 *
 * Out of scope for this MVP:
 *   • Əkin planı (352-row sowing plan) — too granular for a forward
 *     forecast; would explode IndicatorValue cardinality.
 *   • Cost card / AVCO / Corn Purchase — kept as references in Company
 *     settings for the AI Explainer to pick up.
 *   • PPE / Tech / GDX — infrastructure capacity data, separate Phase.
 */

export interface ForwardForecastYear {
  /** Calendar year (2026, 2027, ...). */
  year: number
  /** Total consolidated revenue for the entity (AZN). */
  totalRevenueAzn: number
  /** Per-business-unit breakdown (Buğda / Şəkər çuğunduru / etc). */
  breakdown: Array<{
    businessUnit: string
    revenueAzn: number
  }>
}

export interface IcmalParseResult {
  /** Year-by-year forward forecast (from 2026 baseline up to 2035 + Terminal). */
  forecast: ForwardForecastYear[]
  /** Source year column → reused for Terminal label. */
  hasTerminalValue: boolean
  warnings: string[]
  /** Total rows examined. */
  rowsExamined: number
}

/** Convert a cell value to a number, tolerating string-encoded floats
 *  (with commas or whitespace). Returns 0 on failure. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const cleaned = v.replace(/[\s ]/g, "").replace(",", ".")
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** Treat as Revenue row when col 0 is "Revenue" (English) or
 *  "Gəlir" (Azerbaijani) — defensive against translation variants. */
function isRevenueRow(rowLabel: unknown): boolean {
  if (typeof rowLabel !== "string") return false
  const s = rowLabel.trim().toLowerCase()
  return s === "revenue" || s === "gəlir" || s === "gelir"
}

/** Treat "Satış gəliri" / "Sales revenue" / "Total revenue" as the
 *  totals row (skipped from breakdown — it's the SUM of all Revenue
 *  rows below). */
function isTotalRow(rowLabel: unknown, valueCol: unknown): boolean {
  if (typeof rowLabel !== "string") return false
  const s = rowLabel.trim().toLowerCase()
  if (s === "group" || s === "groups") {
    // Look at column B for the descriptor
    if (typeof valueCol === "string") {
      const c = valueCol.trim().toLowerCase()
      return (
        c.includes("satış gəliri") ||
        c.includes("sales revenue") ||
        c.includes("total revenue") ||
        c.includes("toplam gəlir")
      )
    }
  }
  return false
}

/**
 * Parse the İcmal sheet from an AOA.
 *
 * Layout (per the actual May 19 workbook):
 *   row 0: optional title row
 *   row 1: "Business Unit" header at col 1
 *   row 2: "All" filter
 *   row 3: year columns header. cols [2..11] = 2026..2035, col [13] = Terminal
 *   row 4: first Revenue row (e.g. "Revenue | Buğda | 15836740 | ...")
 *   row N: total row "Group | Satış gəliri | ..." (skipped)
 */
export function parseIcmalFromAoa(aoa: unknown[][]): IcmalParseResult {
  const warnings: string[] = []

  // Find the year-header row. Heuristic: scan for a row where ≥1 of the
  // first 14 cells is a number in range 2025–2050 (year label).
  // The threshold is intentionally permissive — tests use 1-2 years,
  // production uses 10 years; both must work.
  let yearHeaderRow = -1
  for (let r = 0; r < Math.min(aoa.length, 10); r++) {
    const row = aoa[r] || []
    let yearLikeCount = 0
    for (let c = 0; c < Math.min(row.length, 14); c++) {
      const v = row[c]
      if (typeof v === "number" && v >= 2025 && v <= 2050) yearLikeCount++
    }
    if (yearLikeCount >= 1) {
      yearHeaderRow = r
      break
    }
  }
  if (yearHeaderRow < 0) {
    return {
      forecast: [],
      hasTerminalValue: false,
      warnings: ["Could not locate year-header row in İcmal sheet"],
      rowsExamined: aoa.length,
    }
  }

  // Build column → year map.
  const headerRow = aoa[yearHeaderRow] || []
  const yearCols = new Map<number, number>() // col idx → year
  let terminalCol = -1
  for (let c = 0; c < headerRow.length; c++) {
    const v = headerRow[c]
    if (typeof v === "number" && v >= 2025 && v <= 2050) {
      yearCols.set(c, Math.trunc(v))
    } else if (typeof v === "string" && /terminal/i.test(v)) {
      terminalCol = c
    }
  }

  if (yearCols.size === 0) {
    return {
      forecast: [],
      hasTerminalValue: false,
      warnings: [`Year header row ${yearHeaderRow + 1} had no recognizable year columns`],
      rowsExamined: aoa.length,
    }
  }

  // Accumulate per-year × business-unit revenues.
  type PerYearBu = Map<string, number> // BU label → revenue
  const yearData = new Map<number, PerYearBu>()
  for (const year of yearCols.values()) yearData.set(year, new Map())

  // Walk data rows.
  for (let r = yearHeaderRow + 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    // Skip total rows
    if (isTotalRow(row[0], row[1])) continue
    if (!isRevenueRow(row[0])) continue
    const bu = typeof row[1] === "string" ? row[1].trim() : ""
    if (!bu) continue
    for (const [col, year] of yearCols.entries()) {
      const val = num(row[col])
      if (val === 0) continue
      const buMap = yearData.get(year)!
      buMap.set(bu, (buMap.get(bu) ?? 0) + val)
    }
  }

  // Emit forecast array sorted by year.
  const forecast: ForwardForecastYear[] = []
  const years = Array.from(yearCols.values()).sort((a, b) => a - b)
  for (const year of years) {
    const buMap = yearData.get(year)!
    const breakdown = Array.from(buMap.entries())
      .map(([businessUnit, revenueAzn]) => ({ businessUnit, revenueAzn }))
      .sort((a, b) => b.revenueAzn - a.revenueAzn)
    const total = breakdown.reduce((s, b) => s + b.revenueAzn, 0)
    forecast.push({ year, totalRevenueAzn: total, breakdown })
  }

  return {
    forecast,
    hasTerminalValue: terminalCol >= 0,
    warnings,
    rowsExamined: aoa.length,
  }
}

/**
 * Convenience wrapper that takes a loaded XLSX workbook.
 */
export function parseIcmalSheet(
  workbook: { Sheets: Record<string, unknown>; SheetNames: string[] },
  sheetName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any,
): IcmalParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      forecast: [],
      hasTerminalValue: false,
      warnings: [`Sheet "${sheetName}" not found`],
      rowsExamined: 0,
    }
  }
  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: true,
  }) as unknown[][]
  return parseIcmalFromAoa(aoa)
}
