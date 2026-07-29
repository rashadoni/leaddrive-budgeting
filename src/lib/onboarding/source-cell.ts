/**
 * Phase 11.8b (2026-07-29) — the source-cell key, in one place.
 *
 * `sourceDocument` on `BudgetLine` answers "which cell of which sheet produced
 * this row". It used to be built as
 *
 *     multi-import#<sheet>!<code>@<period>
 *
 * i.e. keyed on the ACCOUNT CODE. A workbook listing the same code on several
 * rows — measured on production, `PLF.07.02.04` appears up to 3× in the 2025
 * PLF sheet — produced ONE key for genuinely different rows, which made the
 * column unusable as a natural key. The row ordinal fixes that.
 *
 * Why this is a module rather than two template literals: the partial unique
 * index in `20260729190000_budget_line_source_cell_unique` is defined by a
 * PREDICATE that matches this exact shape. If the producer drifts and stops
 * emitting the ordinal, the index silently stops covering new rows — it would
 * not fail, it would just quietly guard nothing. `SOURCE_CELL_ORDINAL_RE` is
 * the same expression the index uses, so a test can hold the two together.
 */

/**
 * The index predicate, as a JS regex. Keep in lockstep with the Postgres
 * pattern `'#[0-9]+@[0-9]{4}-[0-9]{2}$'` in the migration — a key that does not
 * match this is NOT covered by the uniqueness guarantee.
 */
export const SOURCE_CELL_ORDINAL_RE = /#[0-9]+@[0-9]{4}-[0-9]{2}$/

export interface SourceCellParts {
  /** Import channel prefix, e.g. "multi-import". */
  channel: string
  sheetName: string
  /** Account code as it appears in the sheet, e.g. "PLF.07.02.04". */
  code: string
  /** 0-based position of the row within the parsed sheet. */
  ordinal: number
  /** "YYYY-MM". */
  period: string
}

/**
 * Build the provenance key for one imported cell.
 *
 * The ordinal sits between the code and the period so the trailing `@<period>`
 * stays where every existing reader expects it.
 */
export function buildSourceCell({
  channel,
  sheetName,
  code,
  ordinal,
  period,
}: SourceCellParts): string {
  return `${channel}#${sheetName}!${code}#${ordinal}@${period}`
}
