/**
 * Check a computed indicator against the client's own statement.
 *
 * 2026-08-02 (11.91) — `IndicatorValue.lastReconciledAt` is one of two fields
 * the decision-grade gate requires, and nothing in the product had ever
 * written it. Only `scripts/audit-company.cjs` did, a manual CLI that has
 * never run on this data, so the terminal withheld certification from every
 * coloured cell in the matrix and said so in a banner across the screen.
 *
 * 11.86 supplied the other half — lineage — and deliberately refused to stamp
 * this one, because the import's post-write verdict proves only that "the rows
 * I parsed were written". `lastReconciledAt` is a claim about a DERIVED value,
 * and recording the weaker proof under the stronger field is the false green
 * that whole module exists to prevent.
 *
 * This is the stronger proof, and the import is the one moment it is available:
 * the workbook is in hand. These sheets compute their own `PLF.01`, `PLF.03`,
 * `PLF.08` and `PLF.10`, and the importer never reads them — so an indicator
 * derived bottom-up from the leaves can be compared against the client's own
 * top-down number. That comparison is what a human did by hand on 2026-08-01,
 * four times, finding a real defect each time.
 *
 * What this does NOT claim: that the formula is the right formula. No
 * reconciliation can. It claims that the number on the screen equals what the
 * client's own statement says for the same quantity, which is the question an
 * auditor asks first.
 */

/** Half a qəpik on an absolute figure; a basis point on a ratio. */
export const RECON_ABS_TOLERANCE = 0.005
export const RECON_RATIO_TOLERANCE = 0.0001

/**
 * How to derive an indicator from the sheet's own stated subtotals.
 *
 * Only indicators the statement ITSELF answers are here. An indicator needing
 * a headcount, a hectare or a commodity price cannot be checked against a P&L
 * and must stay unreconciled — saying otherwise would certify a number against
 * a source that never mentioned it.
 */
const FROM_STATEMENT: Record<
  string,
  { unit: "absolute" | "ratio"; of: (s: Record<string, number>) => number | null }
> = {
  IND_REVENUE_TOTAL: { unit: "absolute", of: (s) => s["PLF.01"] ?? null },
  IND_GROSS_MARGIN: { unit: "ratio", of: (s) => ratio(s["PLF.03"], s["PLF.01"]) },
  IND_EBITDA_MARGIN: { unit: "ratio", of: (s) => ratio(s["PLF.08"], s["PLF.01"]) },
  IND_NET_MARGIN: { unit: "ratio", of: (s) => ratio(s["PLF.10"], s["PLF.01"]) },
  IND_COGS_INTENSITY: {
    unit: "ratio",
    of: (s) => ratio(abs(s["PLF.02"]), s["PLF.01"]),
  },
  FP_GROSS_MARGIN: { unit: "ratio", of: (s) => ratio(s["PLF.03"], s["PLF.01"]) },
}

function abs(n: number | undefined): number | undefined {
  return n === undefined ? undefined : Math.abs(n)
}

/**
 * A margin as a percentage, or null when the statement cannot express one.
 *
 * Zero revenue is the case that matters: `0/0` is not "a margin of zero", it
 * is the absence of a margin, and returning 0 here would reconcile an empty
 * company against a computed 0 and certify it.
 */
function ratio(part: number | undefined, whole: number | undefined): number | null {
  if (part === undefined || whole === undefined) return null
  if (!Number.isFinite(part) || !Number.isFinite(whole)) return null
  if (Math.abs(whole) < RECON_ABS_TOLERANCE) return null
  return (part / whole) * 100
}

export interface IndicatorReconResult {
  code: string
  /** What the client's own statement says this quantity is. */
  expected: number
  /** What the pipeline computed and stored. */
  actual: number
  /** `actual - expected`. */
  delta: number
  /** True when the two agree within tolerance for the quantity's unit. */
  reconciled: boolean
}

/**
 * Reconcile what can be reconciled, and say nothing about the rest.
 *
 * `values` is what the recompute produced for one company and period;
 * `statedSubtotals` is the same sheet's own arithmetic, from `crossFootPlfSheet`.
 * An indicator absent from `FROM_STATEMENT`, or whose statement figure cannot
 * be formed, is simply not returned — the caller stamps only what appears here,
 * so silence means "not checked" and never "checked and fine".
 */
export function reconcileAgainstStatement(
  values: ReadonlyArray<{ code: string; value: number | null }>,
  statedSubtotals: Record<string, number>,
): IndicatorReconResult[] {
  const out: IndicatorReconResult[] = []
  for (const v of values) {
    if (v.value === null || !Number.isFinite(v.value)) continue
    const rule = FROM_STATEMENT[v.code]
    if (!rule) continue
    const expected = rule.of(statedSubtotals)
    if (expected === null) continue
    const delta = v.value - expected
    const tolerance =
      rule.unit === "ratio" ? RECON_RATIO_TOLERANCE * 100 : RECON_ABS_TOLERANCE
    out.push({
      code: v.code,
      expected,
      actual: v.value,
      delta,
      reconciled: Math.abs(delta) <= tolerance,
    })
  }
  return out
}

/** The codes this module is able to check at all — for the caller's report. */
export function reconcilableIndicatorCodes(): string[] {
  return Object.keys(FROM_STATEMENT)
}
