/**
 * Control-total verdict for the Universal Import review gate (Phase 2).
 *
 * Arbitrary client files have no separate master/control sheet, so we use the
 * file's OWN internal redundancy as the control: a parent/subtotal row vs the
 * sum of its leaf children. The applier's `dedupeParentRollups` already drops
 * each parent (carrying its stated total in `parentRollupsDropped`) and re-adds
 * the remainder as a synthetic `<parent>-__UNALLOCATED__` leaf (the delta, in
 * `parentRollupsUnallocated`). A non-trivial delta means the parent's stated
 * total disagrees with its leaves — the classic signature of a MIS-MAPPED
 * column (e.g. a label column read as an amount → leaves go to ~0 while the
 * parent total stands).
 *
 * Pure, deterministic, no DB/LLM — unit-tested in isolation. Reuses the same
 * tolerance band as the bit-perfect reconciler (0.005 AZN abs, 1% drift).
 */

const DEFAULT_TOLERANCE_AZN = 0.005
const DEFAULT_YELLOW_PCT = 0.01

export interface ControlTotal {
  /** Parent account code whose leaves were checked. */
  code: string
  /** Parent's stated total (annual). */
  statedTotal: number
  /** Sum of the parent's leaf children (= stated − delta). */
  leafSum: number
  /** stated − Σleaves. Non-zero = mismatch. */
  delta: number
  /** |delta| / |stated| (0..1; 1 when stated is ~0 but delta isn't). */
  deltaPct: number
}

export interface ControlTotalReport {
  /** One row per parent whose leaves did NOT reconcile to its stated total. */
  controlTotals: ControlTotal[]
  /** green = everything ties; yellow = ≤1% rounding drift; red = >1% (likely mis-map). */
  verdict: "green" | "yellow" | "red"
  /** The single worst mismatch (largest deltaPct), or null when green. */
  worst: ControlTotal | null
  /** True when the file carried NO parent rows at all → no internal control. */
  noControl: boolean
}

export function computeControlTotals(
  dropped: Array<{ code: string; plannedAnnual: number; leafSum?: number }>,
  synthetic: Array<{ parentCode: string; plannedAnnual: number }>,
  opts: { toleranceAzn?: number; yellowPct?: number } = {},
): ControlTotalReport {
  const tol = opts.toleranceAzn ?? DEFAULT_TOLERANCE_AZN
  const yellow = opts.yellowPct ?? DEFAULT_YELLOW_PCT

  const statedByParent = new Map(dropped.map((d) => [d.code, d.plannedAnnual]))

  const deltaPctOf = (statedTotal: number, delta: number): number =>
    Math.abs(statedTotal) > 1e-9
      ? Math.abs(delta) / Math.abs(statedTotal)
      : Math.abs(delta) > tol
        ? 1
        : 0

  // (A) Computed-subtotal mode (deep dotted hierarchies): dedup tagged each
  // SECTION-ROOT parent with an explicit `leafSum` = Σ deepest-leaf
  // descendants. Reconcile the section's STATED total against its TRUE leaves
  // directly — intermediate subtotals carry no `leafSum` and are NOT checked
  // (they're redundant computed displays). No synthetic is produced in this
  // mode, so (A) and (B) never both fire for the same sheet.
  const fromLeafSum: ControlTotal[] = dropped
    .filter((d): d is { code: string; plannedAnnual: number; leafSum: number } =>
      typeof d.leafSum === 'number',
    )
    .map((d) => {
      const statedTotal = d.plannedAnnual
      const leafSum = d.leafSum
      const delta = statedTotal - leafSum
      return { code: d.code, statedTotal, leafSum, delta, deltaPct: deltaPctOf(statedTotal, delta) }
    })

  // (B) SAP rollup mode: each `synthetic` __UNALLOCATED__ leaf carries the
  // parent-minus-children delta; leafSum is back-derived from it.
  const fromSynthetic: ControlTotal[] = synthetic.map((s) => {
    const statedTotal = statedByParent.get(s.parentCode) ?? 0
    const delta = s.plannedAnnual
    const leafSum = statedTotal - delta
    return { code: s.parentCode, statedTotal, leafSum, delta, deltaPct: deltaPctOf(statedTotal, delta) }
  })

  const controlTotals: ControlTotal[] = [...fromLeafSum, ...fromSynthetic]
    // Only keep genuine mismatches (drop IEEE-754 noise within tolerance).
    .filter((c) => Math.abs(c.delta) > tol)
    .sort((a, b) => b.deltaPct - a.deltaPct)

  // `noControl` = the file had no parent rows to check against at all
  // (dropped is empty). Caller surfaces "manual review only" — never green.
  const noControl = dropped.length === 0

  let verdict: ControlTotalReport["verdict"]
  if (controlTotals.length === 0) {
    verdict = "green"
  } else {
    const maxPct = controlTotals[0].deltaPct
    verdict = maxPct <= yellow ? "yellow" : "red"
  }

  return {
    controlTotals,
    verdict,
    worst: controlTotals[0] ?? null,
    noControl,
  }
}
