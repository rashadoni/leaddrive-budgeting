/**
 * Phase 11.37 (2026-07-29) — read the money unit off the workbook instead of
 * assuming it.
 *
 * 11.18 confirmed by measurement that AzerSheker's consolidated `BS` tab is in
 * thousands, so the hardcoded ×1000 is right for this file. It stays an
 * assumption for the NEXT file, and the reconciliation guard cannot help:
 * Σ(leaves) and the subtotal cell are both scaled by the factor, so the check
 * is scale-invariant and passes for any multiplier.
 *
 * The workbook states its own unit. `CONS PL_1!A1` reads "AZN thousand". This
 * module turns that into the factor rather than leaving it to a constant.
 *
 * Why the matching is strict
 * ──────────────────────────
 * A loose scan for "AZN" over the real pack finds `Revenue, AZN` (a column
 * header on a sales sheet), `HF kommunal -000021401 …` and `Продажи 000000003
 * от 02.01.2026` — every one of which would hand back a confident, wrong
 * factor. So a cell is accepted ONLY when, after punctuation is stripped,
 * every token is a currency word, a magnitude word or filler, AND both a
 * currency and a magnitude are present. A cell carrying any other content is
 * not a unit declaration, whatever else it says.
 */

/** Multiplier that converts a stated unit into base currency units. */
export interface UnitScale {
  /** e.g. 1000 for "AZN thousand". A bare currency is not accepted — see
   *  `parseUnitLabel`. */
  factor: number
  /** The cell text that decided it, for the audit trail. */
  label: string
  /** Where it was read from, e.g. `CONS PL_1!A1`. */
  source: string
}

const CURRENCY_TOKENS = new Set([
  "AZN",
  "MANAT",
  "MANATI",
  "MAN",
  "USD",
  "EUR",
  "RUB",
  "TRY",
  "₼",
  "$",
  "€",
])

/** Filler that may accompany a unit declaration without changing it. */
const FILLER_TOKENS = new Set([
  "IN",
  "FIGURES",
  "AMOUNTS",
  "ALL",
  "OF",
  "S",
  "İLƏ",
  "В",
])

const MAGNITUDE_TOKENS: Array<{ tokens: string[]; factor: number }> = [
  {
    tokens: ["THOUSAND", "THOUSANDS", "MIN", "MİN", "TYS", "ТЫС", "ТЫСЯЧ", "ТЫСЯЧАХ", "000"],
    factor: 1_000,
  },
  {
    tokens: ["MILLION", "MILLIONS", "MLN", "MLN.", "MİLYON", "MILYON", "МЛН", "МИЛЛИОНОВ"],
    factor: 1_000_000,
  },
  { tokens: ["BILLION", "BILLIONS", "MLRD", "MİLYARD", "МЛРД"], factor: 1_000_000_000 },
]

const MAGNITUDE_BY_TOKEN = new Map<string, number>()
for (const { tokens, factor } of MAGNITUDE_TOKENS) {
  for (const t of tokens) MAGNITUDE_BY_TOKEN.set(t, factor)
}

/**
 * Parse one cell as a unit declaration.
 *
 * Returns null when the text is not a unit declaration at all — which is the
 * common case and must NOT be reported as "unit = 1".
 */
export function parseUnitLabel(raw: unknown): { factor: number; label: string } | null {
  if (typeof raw !== "string") return null
  const label = raw.trim()
  // A unit declaration is a label, not prose. The real pack's noise
  // ("Продажи 000000003 от 02.01.2026 16:31:07") is long; this cuts it before
  // tokenizing.
  if (label === "" || label.length > 40) return null

  // `'000` is a unit even though the apostrophe is punctuation.
  const tokens = label
    .toUpperCase()
    .replace(/['"`]/g, "")
    .split(/[^\p{L}\p{N}₼$€]+/u)
    .filter(Boolean)
  if (tokens.length === 0) return null

  let currency = false
  let factor: number | null = null
  for (const token of tokens) {
    if (CURRENCY_TOKENS.has(token)) {
      currency = true
      continue
    }
    const magnitude = MAGNITUDE_BY_TOKEN.get(token)
    if (magnitude !== undefined) {
      // Two different magnitudes in one label is not a unit we can read.
      if (factor !== null && factor !== magnitude) return null
      factor = magnitude
      continue
    }
    if (FILLER_TOKENS.has(token)) continue
    // Any other word means this cell is something else — a column header
    // ("Revenue, AZN"), a description, a document number.
    return null
  }

  // BOTH parts are required.
  //
  // A magnitude with no currency ("thousand") is obviously too weak. A bare
  // currency is the one that had to be learned from the real pack: scanning
  // `Reporting 2026.xlsx` accepted `Marginality!B3 = "AZN"` — a per-row
  // unit-of-measure COLUMN, not a sheet-level declaration — and read it as
  // ×1. That manufactured a "the workbook declares more than one unit"
  // conflict and disabled detection on the very file this exists to read.
  //
  // The cost is accepting less: a workbook genuinely in base units usually
  // writes a bare "AZN", and we will not detect it. That is the right way to
  // be wrong here — an undetected unit falls back to the assumed factor plus
  // the plausibility band, while a mis-detected one silently rescales a
  // balance sheet.
  if (!currency || factor === null) return null
  return { factor, label }
}

/** Minimal workbook shape — avoids a hard dependency on the xlsx types here. */
export interface UnitScanSheet {
  name: string
  /** Top-left block of the sheet as array-of-arrays. */
  rows: ReadonlyArray<ReadonlyArray<unknown>>
}

export interface UnitScanResult {
  /** The agreed unit, or null when nothing declared one. */
  scale: UnitScale | null
  /**
   * Set when sheets declared DIFFERENT units. The caller must not pick one —
   * a workbook that contradicts itself about its money unit is not something
   * to resolve by preference order.
   */
  conflict: string | null
  /** Every declaration found, for the audit trail. */
  found: UnitScale[]
}

/** How far into a sheet a unit declaration can plausibly sit. */
const SCAN_ROWS = 4
const SCAN_COLS = 3

/** Excel-style A1 reference for the audit trail. */
function cellRef(sheet: string, row: number, col: number): string {
  let c = ""
  let n = col
  do {
    c = String.fromCharCode(65 + (n % 26)) + c
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `${sheet}!${c}${row + 1}`
}

/**
 * Scan the top-left block of each sheet for a unit declaration.
 *
 * `preferredSheets` are scanned first and win on ties; pass the sheet being
 * imported so its own declaration outranks a sibling's.
 */
export function detectWorkbookUnitScale(
  sheets: ReadonlyArray<UnitScanSheet>,
  preferredSheets: ReadonlyArray<string> = [],
): UnitScanResult {
  const preference = new Map(preferredSheets.map((n, i) => [n, i]))
  const ordered = [...sheets].sort(
    (a, b) =>
      (preference.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
      (preference.get(b.name) ?? Number.MAX_SAFE_INTEGER),
  )

  const found: UnitScale[] = []
  for (const sheet of ordered) {
    for (let r = 0; r < Math.min(sheet.rows.length, SCAN_ROWS); r++) {
      const row = sheet.rows[r] ?? []
      for (let c = 0; c < Math.min(row.length, SCAN_COLS); c++) {
        const parsed = parseUnitLabel(row[c])
        if (parsed) {
          found.push({ ...parsed, source: cellRef(sheet.name, r, c) })
        }
      }
    }
  }

  if (found.length === 0) return { scale: null, conflict: null, found }

  const factors = [...new Set(found.map((f) => f.factor))]
  if (factors.length > 1) {
    const detail = found.map((f) => `${f.source} "${f.label}" (×${f.factor})`).join("; ")
    return {
      scale: null,
      conflict: `the workbook declares more than one money unit — ${detail}`,
      found,
    }
  }
  return { scale: found[0], conflict: null, found }
}
