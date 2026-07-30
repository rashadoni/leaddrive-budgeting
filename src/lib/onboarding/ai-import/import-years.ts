/**
 * Multi-year import target (2026-07-30).
 *
 * Why this exists
 * ───────────────
 * A workbook routinely holds more than one year — `actual-budget-v1.xlsx`
 * carries `PLF Actual 2025` and `PLF Actual 2026` side by side — but the
 * importer took a single scalar `year`, so covering the file meant running the
 * whole flow twice: upload, classify, preview, confirm, apply, and again. The
 * detection was already there (`detectWorkbookYears` feeds the year gate that
 * says "workbooks contain 2025, 2026"); only the ability to ACT on more than
 * one was missing.
 *
 * The year stays scalar THROUGH the pipeline on purpose — it resolves the
 * plan, bounds the clean-slate window, and drives every adapter's
 * `preferYear`. Making it a list inside the orchestrator would put a
 * cross-year loop inside the transaction boundary that the reset scope
 * depends on. So the list is expanded at the ROUTE, which runs the existing
 * single-year pipeline once per year, sequentially, each with its own lock.
 *
 * Pure parsing/validation only — no IO.
 */

export const MIN_IMPORT_YEAR = 2020
export const MAX_IMPORT_YEAR = 2050

/**
 * Upper bound on years per request. Each year is a full pipeline run — LLM
 * classification, parse, transaction, recompute — so an unbounded list is a
 * way to blow the route's 300 s budget and leave a half-imported holding.
 * Six covers "a five-year history plus next year's budget".
 */
export const MAX_YEARS_PER_REQUEST = 6

export class ImportYearsError extends Error {}

/**
 * Parse the caller's year selection into an ordered, de-duplicated list.
 *
 * Accepts, in precedence order:
 *   1. `years`   — "2025,2026" (explicit list)
 *   2. `yearFrom` + `yearTo` — an inclusive range
 *   3. `year`    — the historical single value
 *
 * A single value is NOT special-cased into a different code path: it returns a
 * one-element list, so the multi-year loop is the only loop and the single-year
 * case cannot drift away from it.
 */
export function parseImportYears(input: {
  years?: string | null
  yearFrom?: string | null
  yearTo?: string | null
  year?: string | null
  fallbackYear: number
}): number[] {
  const raw = (input.years ?? "").trim()
  if (raw) return normalize(raw.split(",").map((p) => toYear(p, "years")))

  const from = (input.yearFrom ?? "").trim()
  const to = (input.yearTo ?? "").trim()
  if (from || to) {
    if (!from || !to) {
      throw new ImportYearsError(
        "Both 'yearFrom' and 'yearTo' are required for a range",
      )
    }
    const a = toYear(from, "yearFrom")
    const b = toYear(to, "yearTo")
    if (a > b) {
      throw new ImportYearsError(`'yearFrom' (${a}) is after 'yearTo' (${b})`)
    }
    const out: number[] = []
    for (let y = a; y <= b; y++) out.push(y)
    return normalize(out)
  }

  const single = (input.year ?? "").trim()
  if (!single) return [input.fallbackYear]
  return normalize([toYear(single, "year")])
}

function toYear(value: string, field: string): number {
  const n = Number(value.trim())
  if (!Number.isInteger(n) || n < MIN_IMPORT_YEAR || n > MAX_IMPORT_YEAR) {
    throw new ImportYearsError(
      `Field '${field}' must contain integers ${MIN_IMPORT_YEAR}-${MAX_IMPORT_YEAR} (got "${value}")`,
    )
  }
  return n
}

function normalize(years: number[]): number[] {
  const unique = [...new Set(years)].sort((a, b) => a - b)
  if (unique.length === 0) {
    throw new ImportYearsError("No import year supplied")
  }
  if (unique.length > MAX_YEARS_PER_REQUEST) {
    throw new ImportYearsError(
      `At most ${MAX_YEARS_PER_REQUEST} years per request (got ${unique.length}). ` +
        `Each year is a full import run; more would exceed the request budget.`,
    )
  }
  return unique
}

/**
 * Worst verdict across the per-year runs. Ordering red > yellow > green,
 * matching the orchestrator's own aggregation: one bad year makes the whole
 * request bad, because the operator asked for one operation.
 */
export function worstVerdict(
  verdicts: ReadonlyArray<"green" | "yellow" | "red">,
): "green" | "yellow" | "red" {
  if (verdicts.includes("red")) return "red"
  if (verdicts.includes("yellow")) return "yellow"
  return "green"
}
