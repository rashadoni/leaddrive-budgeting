/**
 * Subtotal-only PLF blocks — derive flagged lines from the sheet's own
 * subtotal rows when a block parses to ZERO posting rows (2026-08-18).
 *
 * The case that forced this, measured on `actual-budget-v1.xlsx`:
 *
 * The fact sheet's BU block "EJE" has every leaf row at zero, yet the block's
 * own `PLF.08` (EBITDA) and `PLF.10` (NET) rows state -15,218. The BU splitter
 * dutifully produced a virtual sheet; this parser dutifully parsed 0 leaves;
 * the handler read "0 rows on a non-empty sheet" as "unknown layout" and sent
 * a perfectly well-understood sheet to the paid dynamic detector — which
 * found the same zero leaves. The block vanished. The consolidated dashboard
 * showed EBITDA 271,160 while the file's own bottom line says 255,942, and
 * budget-vs-fact compared different sets of companies, because the BUDGET
 * sheet's EJE block has a real posting row and imported fine.
 *
 * The cross-foot (plf-crossfoot.ts) had already measured the gap at parse
 * time — parsed total 0 against a stated bottom line of -15,218 — but the
 * zero-rows branch in the handler returned before that warning could travel.
 *
 * What this derives
 * ─────────────────
 * One flagged `.99.DV` line per material stated section, plus two residuals
 * that force the derived block to hit the sheet's own EBITDA and NET exactly:
 *
 *   PLF.01 → PLF.01.99.DV (revenue)   stated top line
 *   PLF.02 → PLF.02.99.DV (cogs)      stated cost of goods
 *   PLF.04 → PLF.04.99.DV (expense)   stated S&M cost
 *   PLF.05 → PLF.05.99.DV (expense)   stated supporting cost
 *   PLF.12 → PLF.12.99.DV (expense)   stated provisions
 *   EBITDA residual → PLF.05.98.DV    stated PLF.08 minus all of the above
 *   NET residual    → PLF.09.99.DV    stated PLF.10 minus stated PLF.08
 *
 * `.DV` codes match `LEAF_CODE_RE`, classify through plf-chart exactly like
 * client codes (05 → opex, 09 → below EBITDA), and carry labels that say the
 * money was derived. The detail behind them does not exist in the file — the
 * caller's warning says so and asks the workbook owner for posting rows.
 * `PLF.07` is never derived directly (its natures are mixed; see plf-chart) —
 * whatever the block's `PLF.07` holds is captured by the EBITDA residual.
 *
 * What this refuses to do
 * ───────────────────────
 * A block that HAS posting rows but disagrees with its own subtotals is NOT
 * patched — a plug line there would bury real mapping bugs. That case keeps
 * the CROSS-FOOT warning and an operator decision. The zero-rows precondition
 * is the caller's; this module only checks the stated rows are material.
 *
 * Values stay in the FILE's own sign convention — the caller's flip pass
 * treats derived lines exactly like parsed ones. The derivation identity
 * (sections + residual = stated EBITDA) holds per month by construction in
 * any sign convention; the storage sign then follows the same cost-sign
 * decision as every other row. Pure: no I/O, no DB, no LLM.
 */

/** Half a qəpik — same materiality floor the parser uses for cells. */
const SUB_QEPIK = 0.005

export interface DerivedPlfLine {
  code: string
  label: string
  accountType: "revenue" | "cogs" | "expense"
  perMonth: number[]
  presentMonths: boolean[]
  totalAnnual: number
}

export interface SubtotalOnlySynthesis {
  lines: DerivedPlfLine[]
  /** e.g. "PLF.08 -15218.00, PLF.10 -15218.00" — for the caller's warning. */
  statedSummary: string
}

interface StatedRow {
  perMonth: number[]
  presentMonths: boolean[]
}

const SECTION_SYNTH: ReadonlyArray<{
  section: string
  code: string
  accountType: "revenue" | "cogs" | "expense"
  label: string
}> = [
  { section: "PLF.01", code: "PLF.01.99.DV", accountType: "revenue", label: "Derived from stated REVENUE subtotal (block has no posting rows)" },
  { section: "PLF.02", code: "PLF.02.99.DV", accountType: "cogs", label: "Derived from stated COGS subtotal (block has no posting rows)" },
  { section: "PLF.04", code: "PLF.04.99.DV", accountType: "expense", label: "Derived from stated S&M cost subtotal (block has no posting rows)" },
  { section: "PLF.05", code: "PLF.05.99.DV", accountType: "expense", label: "Derived from stated supporting-cost subtotal (block has no posting rows)" },
  { section: "PLF.12", code: "PLF.12.99.DV", accountType: "expense", label: "Derived from stated PROVISIONS subtotal (block has no posting rows)" },
]

/** Sum every row whose col-A code is exactly `code` (stacked blocks sum, the
 *  same way plf-crossfoot reads PLF.10). Null when no numeric cell exists. */
function readStatedRow(
  aoa: readonly unknown[][],
  monthCols: readonly number[],
  code: string,
): StatedRow | null {
  const perMonth = Array<number>(12).fill(0)
  const presentMonths = Array<boolean>(12).fill(false)
  let sawNumber = false
  for (const row of aoa) {
    const c = typeof row?.[0] === "string" ? (row[0] as string).trim() : ""
    if (c !== code) continue
    for (let m = 0; m < 12; m++) {
      const v = row[monthCols[m]]
      if (typeof v === "number" && Number.isFinite(v)) {
        perMonth[m] += v
        presentMonths[m] = true
        sawNumber = true
      }
    }
  }
  return sawNumber ? { perMonth, presentMonths } : null
}

function material(row: StatedRow | null): row is StatedRow {
  return row !== null && row.perMonth.reduce((a, v) => a + Math.abs(v), 0) > SUB_QEPIK
}

function toLine(
  code: string,
  label: string,
  accountType: "revenue" | "cogs" | "expense",
  row: StatedRow,
): DerivedPlfLine {
  return {
    code,
    label,
    accountType,
    perMonth: [...row.perMonth],
    presentMonths: [...row.presentMonths],
    totalAnnual: row.perMonth.reduce((a, b) => a + b, 0),
  }
}

export function synthesizeSubtotalOnlyLines(
  aoa: readonly unknown[][],
  monthCols: readonly number[],
): SubtotalOnlySynthesis | null {
  const stated08 = readStatedRow(aoa, monthCols, "PLF.08")
  const stated10 = readStatedRow(aoa, monthCols, "PLF.10")

  const lines: DerivedPlfLine[] = []
  const summaryParts: string[] = []
  /** Per-month sum of everything derived so far, in the file's convention. */
  const derivedSum = Array<number>(12).fill(0)

  for (const spec of SECTION_SYNTH) {
    const row = readStatedRow(aoa, monthCols, spec.section)
    if (!material(row)) continue
    lines.push(toLine(spec.code, spec.label, spec.accountType, row))
    for (let m = 0; m < 12; m++) derivedSum[m] += row.perMonth[m]
    summaryParts.push(
      `${spec.section} ${row.perMonth.reduce((a, b) => a + b, 0).toFixed(2)}`,
    )
  }

  // EBITDA residual — whatever separates the stated EBITDA from the sections
  // derived above (PLF.07 lives here by design; so does any section the sheet
  // computes into its EBITDA that we did not derive).
  if (stated08) {
    const residual: StatedRow = {
      perMonth: stated08.perMonth.map((v, m) => v - derivedSum[m]),
      presentMonths: stated08.presentMonths,
    }
    if (material(residual)) {
      lines.push(
        toLine(
          "PLF.05.98.DV",
          "Derived EBITDA residual — stated PLF.08 minus derived sections (block has no posting rows)",
          "expense",
          residual,
        ),
      )
      for (let m = 0; m < 12; m++) derivedSum[m] += residual.perMonth[m]
    }
    summaryParts.push(
      `PLF.08 ${stated08.perMonth.reduce((a, b) => a + b, 0).toFixed(2)}`,
    )
  }

  // NET residual — the below-EBITDA money (D&A, interest, tax) the sheet
  // states only as the distance between its own PLF.08 and PLF.10.
  if (stated10) {
    const base = stated08 ? stated08.perMonth : derivedSum
    const residual: StatedRow = {
      perMonth: stated10.perMonth.map((v, m) => v - base[m]),
      presentMonths: stated10.presentMonths,
    }
    if (material(residual)) {
      lines.push(
        toLine(
          "PLF.09.99.DV",
          "Derived below-EBITDA residual — stated PLF.10 minus stated PLF.08 (block has no posting rows)",
          "expense",
          residual,
        ),
      )
    }
    summaryParts.push(
      `PLF.10 ${stated10.perMonth.reduce((a, b) => a + b, 0).toFixed(2)}`,
    )
  }

  if (lines.length === 0) return null
  return { lines, statedSummary: summaryParts.join(", ") }
}
