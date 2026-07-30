/**
 * Phase 11.5b (2026-07-29) — detect which calendar year(s) a workbook is about,
 * cheaply and deterministically, at PREVIEW time.
 *
 * Why this exists
 * ───────────────
 * Phase 11.5 made the import year an explicit user choice instead of the
 * browser's clock, which stops the year being wrong by accident. It does not
 * stop it being wrong on purpose-ish: pick 2026, upload a 2025 workbook, and
 * every adapter's year guard drops every sheet at zero rows. The group then
 * commits "green" with nothing written — and right after a reset that reads as
 * "my numbers are gone".
 *
 * The adapters already know the sheet's year, but they only find out deep
 * inside the apply path, per sheet, after an LLM call. This runs over the raw
 * header rows before any of that, so the UI can pre-fill the year it actually
 * sees and refuse an apply that contradicts it.
 *
 * Deliberately dumb: no LLM, no adapter knowledge, no sheet classification.
 * It reads header-ish cells, collects 4-digit years and Excel date serials,
 * and reports what it found. A detector that tried to be clever here would
 * just be a second, unaudited copy of the parsers.
 */

/** Excel serial 1 = 1900-01-01 (with the 1900 leap-year bug baked in). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

/** Plausible business years. Outside this, a 4-digit number is data, not a year. */
const MIN_YEAR = 2015
const MAX_YEAR = 2035

/**
 * 2026-07-30 — years evidenced by a real MONTH-HEADER SEQUENCE.
 *
 * Why a second, stricter signal
 * ─────────────────────────────
 * The loose scan below answers "does this workbook mention a year", which is
 * the right question for a pre-fill hint and the wrong one for deciding what
 * to IMPORT. Measured on `actual-budget-v1.xlsx`: it reported **fourteen**
 * years (2015…2035). The cause is not stray text — it is MONEY. An amount
 * between 40,000 and 55,000 AZN sits squarely inside the Excel date-serial
 * range, so a column of ordinary figures reads as a column of dates.
 *
 * A real month header is not a lone number in that range: it is a RUN of
 * serials marching ~30 days apart. Requiring three consecutive monthly steps
 * cut fourteen years to three, and attributing each run to the year holding
 * at least a quarter of its cells cut the last one — a lone December-2024
 * comparative column inside an otherwise 2025 header — leaving exactly the
 * 2025 and 2026 the file actually carries.
 */
export interface MonthHeaderYears {
  /** Years carried by a month-header sequence, ascending. */
  years: number[]
  /** Header rows per year — how much of the workbook is about each. */
  counts: Record<number, number>
}

export interface WorkbookYearDetection {
  /** Every plausible year seen, ascending. */
  years: number[]
  /** Year with the most header hits, or null when nothing was found. */
  dominant: number | null
  /** Hit count per year — lets a caller judge how confident to be. */
  counts: Record<number, number>
  /** True when more than one year is present (a multi-year reporting pack). */
  multiYear: boolean
}

function yearFromCell(v: unknown): number | null {
  // Real Date (xlsx cellDates) or Excel serial.
  if (v instanceof Date) {
    const y = v.getUTCFullYear()
    return y >= MIN_YEAR && y <= MAX_YEAR ? y : null
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // A bare year written as a number ("2026") is far more common in these
    // sheets than a serial that happens to land in range, so check it first.
    if (Number.isInteger(v) && v >= MIN_YEAR && v <= MAX_YEAR) return v
    // Excel serials for 2015-2035 sit roughly in 42000-49700.
    if (v > 40_000 && v < 55_000) {
      const y = new Date(EXCEL_EPOCH_MS + v * MS_PER_DAY).getUTCFullYear()
      return y >= MIN_YEAR && y <= MAX_YEAR ? y : null
    }
    return null
  }
  if (typeof v === "string") {
    const m = v.match(/(20\d{2})/)
    if (!m) return null
    const y = Number(m[1])
    return y >= MIN_YEAR && y <= MAX_YEAR ? y : null
  }
  return null
}

/**
 * Scan the top of every sheet for years.
 *
 * @param rowsPerSheet How many leading rows to inspect. Headers live near the
 *   top; scanning the body would drown the signal in transaction dates that
 *   say nothing about which year the sheet is FOR.
 */
export function detectWorkbookYears(
  // Structurally typed rather than importing XLSX's own types: this module is
  // pure and must stay callable from tests with a hand-built stub.
  workbook: {
    SheetNames: string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Sheets: Record<string, any>
  },
  xlsx: {
    utils: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sheet_to_json: (sheet: any, opts: any) => any[]
    }
  },
  rowsPerSheet = 12,
): WorkbookYearDetection {
  const counts: Record<number, number> = {}

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    accumulateSheetYears(counts, sheet, xlsx, rowsPerSheet)
  }

  return summarize(counts)
}

/**
 * 2026-07-30 — the same scan, for ONE sheet.
 *
 * Extracted so an adapter can ask "is this sheet even about my year?" BEFORE
 * paying for an LLM call. The zero-row fallback in the financial handlers used
 * to delegate any empty parse straight to the dynamic detector, so every sheet
 * belonging to a different year cost one Claude call — and if the detector
 * came back below its confidence floor it set `blocked`, which the routing
 * gate turns into a refusal of the WHOLE import. A two-year workbook could
 * therefore block on the half the operator did not ask for.
 *
 * Same logic as the workbook-wide scan, deliberately: two copies of "what year
 * is this" would drift, and this one decides whether real data is skipped.
 */
export function detectSheetYears(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheet: any,
  xlsx: {
    utils: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sheet_to_json: (sheet: any, opts: any) => any[]
    }
  },
  rowsPerSheet = 12,
): WorkbookYearDetection {
  const counts: Record<number, number> = {}
  if (sheet) accumulateSheetYears(counts, sheet, xlsx, rowsPerSheet)
  return summarize(counts)
}

function accumulateSheetYears(
  counts: Record<number, number>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheet: any,
  xlsx: {
    utils: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sheet_to_json: (sheet: any, opts: any) => any[]
    }
  },
  rowsPerSheet: number,
): void {
  let aoa: unknown[][]
  try {
    aoa = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false })
  } catch {
    // A malformed sheet must not sink the whole detection — the caller
    // treats "no year found" as "cannot pre-fill", never as an error.
    return
  }
  for (const row of aoa.slice(0, rowsPerSheet)) {
    if (!Array.isArray(row)) continue
    // Count each year at most once per row: a 12-month header row would
    // otherwise outvote every other signal in the workbook 12:1.
    const seenInRow = new Set<number>()
    for (const cell of row) {
      const y = yearFromCell(cell)
      if (y !== null) seenInRow.add(y)
    }
    for (const y of seenInRow) counts[y] = (counts[y] ?? 0) + 1
  }
}

function summarize(counts: Record<number, number>): WorkbookYearDetection {
  const years = Object.keys(counts).map(Number).sort((a, b) => a - b)
  let dominant: number | null = null
  let best = -1
  for (const y of years) {
    if (counts[y] > best) {
      best = counts[y]
      dominant = y
    }
  }
  return { years, dominant, counts, multiYear: years.length > 1 }
}

/** Consecutive monthly steps, in days. Feb→Mar is 28; Jul→Aug is 31. */
const MIN_MONTH_GAP = 26
const MAX_MONTH_GAP = 32
/** A run shorter than this is a coincidence, not a header. */
const MIN_RUN = 3
/** A year holding less than this share of a run is a comparative column. */
const MIN_YEAR_SHARE = 0.25

function serialToYear(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null
  if (v <= 40_000 || v >= 55_000) return null
  const y = new Date(EXCEL_EPOCH_MS + v * MS_PER_DAY).getUTCFullYear()
  return y >= MIN_YEAR && y <= MAX_YEAR ? y : null
}

/** Years a single row carries as a month-header sequence. */
function monthHeaderYearsInRow(row: unknown[]): Set<number> {
  const out = new Set<number>()
  const serials: number[] = []
  for (const cell of row) {
    if (serialToYear(cell) !== null) serials.push(cell as number)
  }
  if (serials.length < MIN_RUN) return out

  const flush = (run: number[]): void => {
    if (run.length < MIN_RUN) return
    const per = new Map<number, number>()
    for (const v of run) {
      const y = serialToYear(v)
      if (y !== null) per.set(y, (per.get(y) ?? 0) + 1)
    }
    // Attribute the run to the year(s) that DOMINATE it. A single
    // December-2024 cell opening a 2025 header is a comparative period, not a
    // year the sheet is about — offering it would invite an import that writes
    // one month.
    for (const [y, n] of per) {
      if (n / run.length >= MIN_YEAR_SHARE) out.add(y)
    }
  }

  let run: number[] = [serials[0]]
  for (let i = 1; i < serials.length; i++) {
    const gap = serials[i] - serials[i - 1]
    if (gap >= MIN_MONTH_GAP && gap <= MAX_MONTH_GAP) run.push(serials[i])
    else {
      flush(run)
      run = [serials[i]]
    }
  }
  flush(run)
  return out
}

/**
 * Which years does this workbook actually hold DATA for?
 *
 * Use this to decide what to import. Use {@link detectWorkbookYears} only for
 * a soft hint — it answers a looser question and, on a real workbook, answers
 * it with money mistaken for dates.
 */
export function detectMonthHeaderYears(
  workbook: {
    SheetNames: string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Sheets: Record<string, any>
  },
  xlsx: {
    utils: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sheet_to_json: (sheet: any, opts: any) => any[]
    }
  },
  rowsPerSheet = 12,
): MonthHeaderYears {
  const counts: Record<number, number> = {}
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    let aoa: unknown[][]
    try {
      aoa = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false })
    } catch {
      continue
    }
    for (const row of aoa.slice(0, rowsPerSheet)) {
      if (!Array.isArray(row)) continue
      for (const y of monthHeaderYearsInRow(row)) {
        counts[y] = (counts[y] ?? 0) + 1
      }
    }
  }
  return {
    years: Object.keys(counts).map(Number).sort((a, b) => a - b),
    counts,
  }
}
