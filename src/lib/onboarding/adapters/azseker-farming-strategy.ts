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

import { parseNumericCell } from "../numeric-cell"

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

/**
 * Convert a cell value to a number. Returns 0 on failure.
 *
 * Phase 11.31 — delegates to the one numeric cell parser. The local version
 * replaced the FIRST comma with a dot, so `"1,234"` (1234) became 1.234 and
 * `"1,234,56"` became the un-numeric `1.234.56` → 0.
 *
 * The `?? 0` stays: these rows are summed into a forward forecast, and a null
 * would change every caller's shape. But a 0 here is worse than a wrong
 * number — the caller SKIPS zeros as "no revenue for this business unit", so
 * an unreadable cell removes the unit from the forecast rather than showing
 * anything wrong. Hence 11.38.
 */
/**
 * Phase 11.38 (2026-07-29) — report the cells this returns 0 for.
 *
 * The parse became correct in 11.31; the `?? 0` kept the other half of the
 * defect: an unreadable cell and a real 0.00 reach the caller as the same
 * number. `parseNumericCell` already says WHY it failed — this drops that
 * reason into the adapter's warnings instead of discarding it.
 *
 * An EMPTY cell is not reported: absent is not invalid, and warning on every
 * blank would bury the cells that matter. The ambiguous verdict IS reported —
 * a single separator before exactly three digits ("1,234") is 1234 under
 * grouping and 1.234 under a decimal reading, and a flag nobody surfaces is
 * the same as no flag.
 */
export interface NumericWarnCtx {
  warnings: string[]
  /** 0-based row index; reported +1 to match the spreadsheet. */
  row: number
  /** What the cell was being read as, e.g. "revenue". */
  field: string
}

function num(v: unknown, ctx?: NumericWarnCtx): number {
  const parsed = parseNumericCell(v)
  if (ctx && parsed.reason) {
    ctx.warnings.push(
      parsed.value === null
        ? `Row ${ctx.row + 1}: ${ctx.field} — ${parsed.reason}; read as 0`
        : `Row ${ctx.row + 1}: ${ctx.field} — ${parsed.reason}`,
    )
  }
  return parsed.value ?? 0
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
      const val = num(row[col], { warnings, row: r, field: `revenue ${year}` })
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

// ──────────────────────────────────────────────────────────────────────
// Phase 7.M Tier 6 — "Sales plan" sheet parser (CPC per-product
// forward volumes 2027-2035).
// ──────────────────────────────────────────────────────────────────────

export interface SalesPlanProductFact {
  /** Calendar year (2027-2035). */
  year: number
  /** Canonical product label (col "Product (Sales)" in the workbook). */
  productLabel: string
  /** Stable slug derived from productLabel — used as part of the
   *  operational_facts metric name. */
  productSlug: string
  /** Top-level group from col "Group" (Qlukoza / Fruktoza / Nişasta /
   *  Yan məhsul). */
  group: string
  /** Sales channel from col "Location" (Azerbaijan / Export / ---).
   *  Empty string when "---" (byproduct, no destination). */
  location: string
  /** Volume in tons. */
  volumeTons: number
}

export interface SalesPlanParseResult {
  facts: SalesPlanProductFact[]
  warnings: string[]
  /** Total data rows examined (excludes header). */
  rowsExamined: number
}

/** Convert a free-text product label into a stable slug suitable for
 *  embedding into a metric name. Strips non-alphanumerics, lowercases,
 *  collapses runs of `_`. Mirror of the slug rule in
 *  `azseker-workbook-sales.ts` so downstream metric names stay
 *  consistent across the two sales-data shapes. */
function slugifyProduct(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // Keep azerbaijani-extended letters (ə / ş / ç / ğ / ı / ö / ü) as
    // basic latin substitutions so we don't blow up the slug.
    .replace(/ə/g, "e")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
}

/**
 * Parse the "Sales plan" sheet AOA. Layout (from May 19 workbook):
 *   row 0: separator
 *   row 1: header
 *     col 0 "For PLF" | col 1 "Group" | col 2 "Location" | col 3 "For PL"
 *     col 4 Production Step 3 | col 5 Production Step 4
 *     col 6 "Product (Sales)" — canonical label
 *     col 7 null
 *     cols 8..16: VOLUME years 2027..2035
 *     (cols 17+ are cost / price / revenue sections — out of scope)
 *   row 2+: data rows
 */
export function parseSalesPlanFromAoa(aoa: unknown[][]): SalesPlanParseResult {
  const warnings: string[] = []
  const facts: SalesPlanProductFact[] = []
  if (aoa.length < 2) {
    warnings.push("Sales plan has fewer than 2 rows — no data to parse")
    return { facts, warnings, rowsExamined: 0 }
  }

  // Locate the header row. Heuristic: scan first 5 rows for one that
  // contains the literal "Product (Sales)" string at any column index;
  // the year columns are the 9 immediate-following numeric cells (allow
  // 1-cell gap for the null separator).
  let headerRow = -1
  let productCol = -1
  let yearStartCol = -1
  for (let r = 0; r < Math.min(5, aoa.length); r++) {
    const row = aoa[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const cell = row[c]
      if (
        typeof cell === "string" &&
        cell.trim().toLowerCase().startsWith("product (sales)")
      ) {
        headerRow = r
        productCol = c
        break
      }
    }
    if (headerRow >= 0) break
  }
  if (headerRow < 0) {
    warnings.push(
      'Header cell "Product (Sales)" not found in first 5 rows — sheet shape changed?',
    )
    return { facts, warnings, rowsExamined: 0 }
  }

  // Find year columns to the right of the product col.
  const headerRowVals = aoa[headerRow] ?? []
  const yearCols: Array<{ col: number; year: number }> = []
  for (let c = productCol + 1; c < headerRowVals.length; c++) {
    const cell = headerRowVals[c]
    if (typeof cell === "number" && cell >= 2026 && cell <= 2099) {
      yearCols.push({ col: c, year: cell })
      if (yearStartCol < 0) yearStartCol = c
    } else if (yearCols.length > 0) {
      // Stop at the first non-year cell AFTER we've collected at least
      // one — protects against picking up the second 2027..2035 block
      // (production volumes, cost, etc.).
      break
    }
  }
  if (yearCols.length === 0) {
    warnings.push(
      `No year columns (2026..2099) found to the right of "Product (Sales)" at col ${productCol}`,
    )
    return { facts, warnings, rowsExamined: 0 }
  }

  // Data rows start one below the header.
  let rowsExamined = 0
  for (let r = headerRow + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const productLabel = row[productCol]
    if (typeof productLabel !== "string" || productLabel.trim() === "") {
      continue
    }
    rowsExamined++
    const groupRaw = row[1]
    const locationRaw = row[2]
    const group =
      typeof groupRaw === "string" ? groupRaw.trim() : String(groupRaw ?? "")
    const locationStr =
      typeof locationRaw === "string"
        ? locationRaw.trim()
        : String(locationRaw ?? "")
    const location = locationStr === "---" ? "" : locationStr
    const slug = slugifyProduct(productLabel)
    if (!slug) {
      warnings.push(
        `row ${r + 1}: product "${productLabel}" produced empty slug — skipped`,
      )
      continue
    }
    for (const { col, year } of yearCols) {
      const v = num(row[col], { warnings, row: r, field: `volume ${year}` })
      if (v === 0) continue // skip zero-volume cells to avoid noise
      facts.push({
        year,
        productLabel: productLabel.trim(),
        productSlug: slug,
        group,
        location,
        volumeTons: v,
      })
    }
  }
  return { facts, warnings, rowsExamined }
}

/** Convenience wrapper — load + parse the Sales plan sheet from a
 *  workbook by name. */
export function parseSalesPlanSheet(
  workbook: { Sheets: Record<string, unknown>; SheetNames: string[] },
  sheetName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any,
): SalesPlanParseResult {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    return {
      facts: [],
      warnings: [`Sheet "${sheetName}" not found`],
      rowsExamined: 0,
    }
  }
  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: true,
  }) as unknown[][]
  return parseSalesPlanFromAoa(aoa)
}
