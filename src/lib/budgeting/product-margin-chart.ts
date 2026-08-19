/**
 * The product chart, rebuilt on money (2026-08-19).
 *
 * ## What was wrong with putting the rate on the axis
 *
 * The chart plotted margin PERCENT per product, so every product occupied the
 * same amount of chart no matter how much of the business it was. On the
 * client's 2025 actuals that meant a line carrying 142 AZN of revenue — corn,
 * 142 against 654 of cost, a true −360.6% — drew a bar the full width of the
 * plot and squeezed the entire 29.6M business into the right-hand sixth. The
 * number was arithmetically correct and the picture it painted was false.
 *
 * No axis range fixes that. The flaw is that the rate was the only thing
 * encoded, and a rate says nothing about size.
 *
 * ## What it encodes now
 *
 *   length  gross profit, in money — so 142 AZN looks like 142 AZN and an
 *           outlier is physically incapable of taking over the plot
 *   colour  the margin against the reader's own target slider
 *   label   the margin percent, for the product being looked at
 *
 * One chart, two questions: where the money is earned, and which of it is
 * earned at a weak rate. Exact figures stay in the table below it.
 *
 * Pure.
 */

export interface MarginChartInput {
  productCode: string
  productName: string
  revenue: number
  /** Null when the source carries no usable cost — such a row cannot be drawn. */
  cost: number | null
  marginPct: number | null
}

export type MarginStanding =
  /** At or above the target the reader set. */
  | "at_target"
  /** Profitable, but under the target. */
  | "below_target"
  /** Costs exceed revenue. */
  | "loss"

export interface MarginChartRow {
  productCode: string
  productName: string
  grossProfit: number
  marginPct: number
  standing: MarginStanding
}

export function standingOf(marginPct: number, targetPct: number): MarginStanding {
  if (marginPct < 0) return "loss"
  return marginPct < targetPct ? "below_target" : "at_target"
}

export function buildMarginChartRows(
  products: ReadonlyArray<MarginChartInput>,
  targetPct: number,
): MarginChartRow[] {
  const rows: MarginChartRow[] = []
  for (const p of products) {
    // A withheld ratio has nothing to say here. The row is still in the table
    // and in the "no computable margin" block; drawing it would need a number
    // this screen has deliberately refused to invent.
    if (p.marginPct === null || p.cost === null) continue
    rows.push({
      productCode: p.productCode,
      productName: p.productName,
      grossProfit: p.revenue - p.cost,
      marginPct: p.marginPct,
      standing: standingOf(p.marginPct, targetPct),
    })
  }
  // Biggest earner first, losses at the bottom — the order a reader scans in.
  return rows.sort((a, b) => b.grossProfit - a.grossProfit)
}

/**
 * A symmetric domain would waste half the plot whenever every product earns.
 * The axis starts at zero unless something actually loses money, and then it
 * reaches exactly as far left as that loss and no further.
 */
export function grossProfitDomain(rows: ReadonlyArray<MarginChartRow>): [number, number] {
  let min = 0
  let max = 0
  for (const r of rows) {
    if (r.grossProfit < min) min = r.grossProfit
    if (r.grossProfit > max) max = r.grossProfit
  }
  if (min === 0 && max === 0) return [0, 1]
  return [min, max]
}
