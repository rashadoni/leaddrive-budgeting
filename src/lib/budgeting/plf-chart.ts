/**
 * What each `PLF.*` code IS — stated ONCE, for the importer and the reports.
 *
 * ---------------------------------------------------------------------------
 * The defect this closes (2026-08-01)
 * ---------------------------------------------------------------------------
 *
 * The owner opened `actual-budget-v1.xlsx` in Excel and found 13,453,098 AZN
 * of other-operating income sitting inside Revenue. Every automated check had
 * passed it, because the defect was spread across three files that each did
 * something locally defensible:
 *
 *   1. `azseker-plf.ts` typed an account from its two-digit SECTION alone
 *      (`/^0[3-9]$/ -> "expense"`). Section 07 is titled "OTHER OPERATING
 *      INCOME/EXPENSES" and holds BOTH natures, so subsidies and interest
 *      income were typed as cost and the cost-sign pass negated them: income
 *      landed in `budget_lines` NEGATIVE.
 *   2. `coa-role.ts` compensated by routing `PLF.07.01/.02` into the REVENUE
 *      section, and
 *   3. `revenueContribution` re-flipped the sign to undo (1).
 *
 * Two wrongs made the bottom line right — Net Profit reconciled to the file —
 * while Revenue read 72,333,200 against the workbook's 58,880,102 and gross
 * profit 33,633,277 against 20,180,179. On the P&L page the row "Subsidies -
 * Product" printed −9,231,957 while the Revenue total it fed was +9,231,957
 * higher.
 *
 * ---------------------------------------------------------------------------
 * Why a code map and not the workbook's own taxonomy columns
 * ---------------------------------------------------------------------------
 *
 * The client's taxonomy columns are what SETTLE the question. On
 * `PLF Budget 2026`, col W `FS line_FO` and col Y `Reporting FS Line` tag
 * every `PLF.07` leaf as "Other income/(expense)" — never "Revenue", which is
 * what the real sales rows carry. That is written evidence in the file, not
 * an inference, and it is the authority for every mapping below.
 *
 * They cannot be the RUNTIME driver, though, because they are not there:
 *
 *   PLF Budget 2026   col W `FS line_FO`        1591 of 1920 code rows
 *   PLF Actual 2026   col U `FS line`             49 of 1578 code rows
 *   PLF Actual 2025   col V `FS line`             25 of 1428 code rows
 *
 * Two of the three sheets state the taxonomy for ~2% of their rows. A parser
 * driven by that column would classify almost nothing on the actuals and
 * would have to fall back to the section rule anyway — i.e. keep the defect
 * on exactly the sheets where it is hardest to see. Worse, the column is
 * free text maintained by hand: `PLF.09.02.*` carries the literal `"---"`.
 *
 * So the taxonomy column is the SOURCE of this table and the code is its
 * KEY: one classification, identical across all three sheets and across the
 * actual/budget split, testable without a spreadsheet. When the client adds a
 * `PLF.07` branch this file does not know, `plfOtherOperatingSide` says
 * `"unmapped"` and the parser raises a warning instead of guessing quietly.
 *
 * ---------------------------------------------------------------------------
 * Where PLF.07 belongs, proved by the sheet's own arithmetic
 * ---------------------------------------------------------------------------
 *
 * The workbook computes its own subtotals, and they are an independent check
 * on any placement. Summing the parsed leaves of `PLF Budget 2026` over the
 * four imported entities (EDEN / AZSF / ProMalt / CPC, AJE excluded):
 *
 *   PLF.01 revenue            58,880,102.23
 *   PLF.02 cogs              −38,699,923.16   → PLF.03 GROSS MARGIN 20,180,179.07 ✓
 *   PLF.04 + PLF.05 + PLF.12 −17,366,026.69
 *   PLF.07 (all four sub-
 *          branches, net)     13,076,279.14   → PLF.08 EBITDA      15,890,431.51 ✓
 *   PLF.09                   −12,060,589.81   → PLF.10 NET PROFIT   3,829,841.70 ✓
 *
 * The whole of `PLF.07` — including `.03 Non-Operating Expenses` and
 * `.04 Gain / Loss on Disposal`, which reporting used to push BELOW the line —
 * sits ABOVE EBITDA and OUTSIDE revenue and gross profit. Move any part of it
 * and EBITDA stops equalling the client's own PLF.08 row.
 *
 * ---------------------------------------------------------------------------
 * PLF.08 — one statement, replacing two that contradicted each other
 * ---------------------------------------------------------------------------
 *
 * `plf-leaf-codes.ts` and `azseker-plf.ts` argued at length that `PLF.08.01`
 * ("Shareholders' expense", 174,491 AZN of AZSF 2025 actuals) is a real
 * posting account beneath the EBITDA line and must import — and it does.
 * `coa-role.ts` returned `null` for everything under `PLF.08`, so the money
 * reached the database and then reached no P&L line at all.
 *
 * Both intentions now live here: `PLF.08` EXACTLY is the EBITDA subtotal row
 * (never imported); anything BENEATH it is a posting account below the EBITDA
 * line. The 2025 chart puts three there — `.01` Shareholders' expense, `.02`
 * Expenses of prior periods, `.03` EDEN — which the 2026 chart renumbered to
 * `PLF.09.01`.
 */

/**
 * What a `PLF.*` code is, in P&L terms.
 *
 * `subtotal` is not "unknown" — it is a positive statement that the row holds
 * the sheet's own arithmetic and importing it would double-count the section
 * it summarises.
 */
export type PlfNature =
  | "revenue"
  | "cogs"
  | "opex"
  | "other_operating_income"
  | "other_operating_expense"
  | "below_ebitda"
  | "subtotal"

/**
 * Rows that state a COMPUTED SUBTOTAL rather than a posting account.
 *
 * Matched EXACTLY, never by prefix — `PLF.08.01` is a real account (see the
 * header). `PLF.03` GROSS MARGIN and `PLF.08` EBITDA are childless in this
 * chart of accounts, so once leafness stopped being decided by code depth
 * (11.74) nothing else separated them from an expense line: 34,393,596 AZN of
 * phantom cost in `PLF Budget 2026` alone.
 */
const SUBTOTAL_CODES = new Set(["PLF.03", "PLF.07", "PLF.08", "PLF.10"])

/**
 * Section → nature, for the sections whose nature is uniform.
 *
 * Read together with `SUBTOTAL_CODES`, which wins: `PLF.03` and `PLF.08` are
 * subtotal ROWS whose CHILDREN are ordinary accounts, so both appear here for
 * the children's sake. In the current chart neither has any; an older AZSEKER
 * chart numbered Sales & Marketing `PLF.03.*` (today `PLF.04.*`), and a
 * `PLF.08.*` child is the 2025 chart's Shareholders' expense — below EBITDA,
 * because that is the line `PLF.08` itself draws.
 *
 * `07` is deliberately absent: it is the section that mixes natures, and
 * mixing is exactly what a section number cannot express. It is resolved by
 * branch below.
 *
 * `06` is not present in any AZSEKER sheet read so far; it is kept as `opex`
 * because the historical section rule typed it as expense and there is no
 * evidence to move it. `11` (CHANGE IN FAIR VALUE OF BIOLOGICAL ASSETS, 2025
 * actuals only, zero in every non-eliminating BU) is deliberately NOT mapped:
 * it never imported, it carries no money in this workbook, and its home is
 * the 2025-chart reconciliation, not this fix.
 */
const SECTION_NATURE: Record<string, PlfNature> = {
  "01": "revenue",
  "02": "cogs",
  "03": "opex",
  "04": "opex",
  "05": "opex",
  "06": "opex",
  "08": "below_ebitda",
  "09": "below_ebitda",
  "12": "opex",
}

/** Normalised `PLF.` code, or `null` when this is not a PLF code at all. */
function plfCode(code: unknown): string | null {
  if (typeof code !== "string") return null
  const c = code.trim().toUpperCase()
  return c.startsWith("PLF.") ? c : null
}

/**
 * Which side of the `PLF.07` fence a code sits on.
 *
 * `null` — not under `PLF.07`.
 * `"unmapped"` — under `PLF.07`, but in a branch this table does not know.
 * A caller MUST surface that rather than silently pick a nature: whichever it
 * picked would be wrong half the time, and the money would move without
 * anyone being told.
 */
export type PlfOtherOperatingSide = "income" | "expense" | "unmapped"

export function plfOtherOperatingSide(
  code: unknown,
): PlfOtherOperatingSide | null {
  const c = plfCode(code)
  if (!c || !c.startsWith("PLF.07.")) return null
  // `FS line_FO` = "Other income/(expense)" on every leaf of all four
  // branches; the income/expense split is the client's own branch naming:
  //   .01 Interest Income (non-operating)   .02 Non-Operating Income
  //   .03 Non-Operating Expenses            .04 Gain / Loss on Disposal
  if (c.startsWith("PLF.07.01") || c.startsWith("PLF.07.02")) return "income"
  if (c.startsWith("PLF.07.03") || c.startsWith("PLF.07.04")) return "expense"
  return "unmapped"
}

/**
 * The one classification of a `PLF.*` code. `null` means "no opinion" — the
 * caller falls back to whatever it used before (a non-PLF chart, or `PLF.11`).
 */
export function plfNature(code: unknown): PlfNature | null {
  const c = plfCode(code)
  if (!c) return null
  if (SUBTOTAL_CODES.has(c)) return "subtotal"

  const side = plfOtherOperatingSide(c)
  if (side) {
    // An unmapped branch keeps the historical section treatment (expense) so
    // no money is dropped; `plfOtherOperatingSide` is what makes it audible.
    return side === "income"
      ? "other_operating_income"
      : "other_operating_expense"
  }

  const m = c.match(/^PLF\.(\d{2})/)
  if (!m) return null
  return SECTION_NATURE[m[1]] ?? null
}

/**
 * Signed contribution of a row to the "other operating income/(expense)"
 * line, income-positive.
 *
 * Both sides are stored under their own natural convention — income positive,
 * cost positive — so the sign comes from the CODE, not from a per-row guess
 * about which convention the importer happened to use. That guess is what
 * `revenueContribution` used to be.
 */
export function plfOtherOperatingContribution(
  code: unknown,
  amount: number,
): number {
  return plfOtherOperatingSide(code) === "expense" ? -amount : amount
}
