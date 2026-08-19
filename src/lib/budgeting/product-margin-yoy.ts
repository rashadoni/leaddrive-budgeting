/**
 * This year against last, on the same months (2026-08-19).
 *
 * ## Why the screen needed it, and why it is not the annual card again
 *
 * Two comparisons already exist here and neither can answer "are we doing
 * better than last year": budget-vs-actual compares against a plan, and the
 * annual card compares a delivered rate against the plan's rate. On the
 * client's own five months the answer turns out to be the best number in the
 * dataset — revenue 7,080,084 → 12,725,933 with the margin moving 20.5% →
 * 22.2% — and nothing on the screen said so.
 *
 * ## The honest limit, stated rather than hidden
 *
 * Per-product year-over-year mostly cannot be computed on this client's data,
 * and the reason is structural: the 2025 chart carried the whole processing
 * business as ONE line, "Processed Corn Products", 16.4M of it. The 2026 chart
 * splits that into glucose, corn starch, malt, fructose, corn oil and two
 * byproduct lines. There is no 2025 counterpart to compare any of them with.
 *
 * So a product appears here only when BOTH years carry a usable margin for it,
 * and the count that cannot be compared is returned to be shown. Quietly
 * listing four products out of fourteen would read as "these are the products"
 * and invite a conclusion about a business the list does not describe.
 *
 * Pure: the caller supplies both sides, already restricted to the same months.
 */

export interface YoySide {
  productCode: string
  productName: string
  revenue: number
  /** Null when the source carries no usable cost for this product. */
  cost: number | null
  marginPct: number | null
}

export interface YoyTotals {
  revenue: number
  cost: number
  grossProfit: number
  marginPct: number | null
}

export interface YoyProduct {
  productCode: string
  productName: string
  priorRevenue: number
  priorMarginPct: number
  currentRevenue: number
  currentMarginPct: number
  /** Current rate minus prior rate, in points. */
  marginGapPoints: number
  /** Revenue change as a fraction: 0.8 is +80%. Null when prior was zero. */
  revenueChange: number | null
}

export interface YoyComparison {
  prior: YoyTotals
  current: YoyTotals
  /** Current margin minus prior margin, in points. Null unless both exist. */
  marginGapPoints: number | null
  /** Group revenue change as a fraction. Null when the prior year had none. */
  revenueChange: number | null
  products: YoyProduct[]
  /**
   * Products carrying money this year that have no comparable prior-year
   * figure. Shown as a count with a reason, never dropped in silence.
   */
  notComparable: number
}

/** Totals over the products whose cost is usable — the same rule the rest of
 *  the screen applies, so the two cannot disagree. */
function totals(sides: ReadonlyArray<YoySide>): YoyTotals {
  let revenue = 0
  let cost = 0
  for (const s of sides) {
    if (s.cost === null) continue
    // A cost of exactly zero against real revenue is missing data, not a free
    // product — the same call `summarizeProductMargins` makes. Letting it in
    // would add revenue with nothing behind it and lift the group rate.
    // A cost with NO revenue stays: that cost is real and belongs in the
    // group's numerator, it simply has no denominator of its own.
    if (s.cost === 0 && s.revenue > 0) continue
    revenue += s.revenue
    cost += s.cost
  }
  const grossProfit = revenue - cost
  return {
    revenue,
    cost,
    grossProfit,
    // Weighted by money. An average of the per-product rates would let a
    // 23,253 line weigh as much as a 3,581,237 one.
    marginPct: revenue === 0 ? null : (grossProfit / revenue) * 100,
  }
}

export function buildYoyComparison(
  prior: ReadonlyArray<YoySide>,
  current: ReadonlyArray<YoySide>,
): YoyComparison {
  const priorByCode = new Map(prior.map((p) => [p.productCode, p]))

  const products: YoyProduct[] = []
  let notComparable = 0

  for (const c of current) {
    if (c.marginPct === null || c.revenue === 0) continue
    const p = priorByCode.get(c.productCode)
    if (!p || p.marginPct === null || p.revenue === 0) {
      // Sold this year, nothing to hold it against. Counted, not listed.
      notComparable += 1
      continue
    }
    products.push({
      productCode: c.productCode,
      productName: c.productName,
      priorRevenue: p.revenue,
      priorMarginPct: p.marginPct,
      currentRevenue: c.revenue,
      currentMarginPct: c.marginPct,
      marginGapPoints: c.marginPct - p.marginPct,
      revenueChange: p.revenue === 0 ? null : c.revenue / p.revenue - 1,
    })
  }

  // Worst rate move first: the reason to open this is to find what slipped.
  products.sort((a, b) => a.marginGapPoints - b.marginGapPoints)

  const priorTotals = totals(prior)
  const currentTotals = totals(current)

  return {
    prior: priorTotals,
    current: currentTotals,
    marginGapPoints:
      priorTotals.marginPct === null || currentTotals.marginPct === null
        ? null
        : currentTotals.marginPct - priorTotals.marginPct,
    revenueChange:
      priorTotals.revenue === 0 ? null : currentTotals.revenue / priorTotals.revenue - 1,
    products,
    notComparable,
  }
}
