/**
 * What the delivered part of the year is worth against the ANNUAL plan
 * (2026-08-19).
 *
 * ## The hole this fills
 *
 * The budget-vs-actual card cuts both sides to the months the actuals carry.
 * That is right, and it is the only defence against setting five months of
 * delivery beside twelve months of plan. But it is right only for products
 * whose plan is spread evenly, and this client's biggest products are crops:
 *
 *     Cotton  6,545,120 planned at 28.0% — every manat of it June–December
 *     Wheat  15,836,740 planned at 38.9% — every manat of it June–December
 *
 * Truncating to January–May removes them from the plan entirely while their
 * early sales stay on the actual side (cotton delivered 1,387,524 at 1.1%).
 * So the screen could never show 28% against 1.1%, which is the single most
 * important sentence in this dataset, and instead reported the difference as
 * a group-wide margin miss.
 *
 * ## Why comparing across different windows is legitimate here — and where it stops
 *
 * A margin is a RATIO. "The cotton we have sold kept 1.1%" and "the cotton we
 * planned to sell was to keep 28%" are both rates, and setting one against the
 * other says something true no matter how many months each covers. That is the
 * comparison this module makes, and the only one it makes in points.
 *
 * Revenue is NOT a ratio, so this module never states a revenue variance
 * across the two windows. It states PROGRESS — what share of the annual plan
 * has arrived — and leaves the reader to judge it against how much of the year
 * has passed. Presenting five months of sales as a shortfall against a
 * twelve-month plan is exactly the error the truncation exists to prevent, and
 * it would be reintroduced here by any subtraction.
 *
 * Pure: the caller supplies the three already-aggregated sides.
 */

export interface AnnualSide {
  productCode: string
  productName: string
  revenue: number
  /** Null when the source carries no cost for this product. */
  cost: number | null
}

export interface AnnualProgressRow {
  productCode: string
  productName: string
  planRevenue: number
  planMarginPct: number | null
  actualRevenue: number
  actualMarginPct: number | null
  /**
   * Actual rate minus planned rate, in points. Null unless both rates exist.
   * This is a comparison of rates across different windows — see the header.
   */
  marginGapPoints: number | null
  /**
   * Share of the annual revenue plan delivered so far, as a fraction. Null
   * without an annual plan. Deliberately not a variance.
   */
  revenueProgress: number | null
  /**
   * The plan puts nothing in the months the actuals cover, yet the year plans
   * for this product. These are the rows the month-truncated card cannot show
   * at all, which is why they lead.
   */
  plannedLater: boolean
}

function rate(revenue: number, cost: number | null): number | null {
  // A negative denominator inverts the ratio and returns a plausible-looking
  // number built from two minuses; see `negative_revenue` in product-margin.ts.
  if (cost === null || revenue <= 0) return null
  // A zero cost is not a 100% margin; see `zero_cost` in product-margin.ts.
  if (cost === 0) return null
  return ((revenue - cost) / revenue) * 100
}

function index(rows: ReadonlyArray<AnnualSide>): Map<string, AnnualSide> {
  const m = new Map<string, AnnualSide>()
  for (const r of rows) m.set(r.productCode, r)
  return m
}

export function buildAnnualProgress(
  planFullYear: ReadonlyArray<AnnualSide>,
  planInWindow: ReadonlyArray<AnnualSide>,
  actualInWindow: ReadonlyArray<AnnualSide>,
): AnnualProgressRow[] {
  const full = index(planFullYear)
  const window = index(planInWindow)
  const actual = index(actualInWindow)

  const codes = new Set<string>([...full.keys(), ...actual.keys()])
  const rows: AnnualProgressRow[] = []

  for (const code of codes) {
    const f = full.get(code)
    const a = actual.get(code)
    const w = window.get(code)
    const planRevenue = f?.revenue ?? 0
    const actualRevenue = a?.revenue ?? 0
    if (planRevenue === 0 && actualRevenue === 0) continue

    const planMarginPct = f ? rate(f.revenue, f.cost) : null
    const actualMarginPct = a ? rate(a.revenue, a.cost) : null

    rows.push({
      productCode: code,
      productName: a?.productName ?? f?.productName ?? code,
      planRevenue,
      planMarginPct,
      actualRevenue,
      actualMarginPct,
      marginGapPoints:
        planMarginPct === null || actualMarginPct === null
          ? null
          : actualMarginPct - planMarginPct,
      revenueProgress: planRevenue === 0 ? null : actualRevenue / planRevenue,
      // Nothing planned in the window, something planned for the year, and
      // something actually sold: the crop case exactly.
      plannedLater: planRevenue > 0 && (w?.revenue ?? 0) === 0 && actualRevenue > 0,
    })
  }

  // The rows the other card cannot show come first; then the worst rate miss.
  return rows.sort((x, y) => {
    if (x.plannedLater !== y.plannedLater) return x.plannedLater ? -1 : 1
    const gx = x.marginGapPoints
    const gy = y.marginGapPoints
    if (gx === null && gy === null) return y.planRevenue - x.planRevenue
    if (gx === null) return 1
    if (gy === null) return -1
    return gx - gy
  })
}

/**
 * Gross profit still to be earned if the rest of a product's annual plan
 * realises at the rate delivered so far instead of the rate planned.
 *
 * An extrapolation, and labelled as one wherever it is shown: it assumes the
 * remaining volume behaves like what has already been sold, which for a crop
 * sold before its season is an assumption, not a forecast. Null unless both
 * rates are known and there is plan left to deliver.
 */
export function exposureAtDeliveredRate(row: AnnualProgressRow): number | null {
  if (row.planMarginPct === null || row.actualMarginPct === null) return null
  const remaining = row.planRevenue - row.actualRevenue
  if (remaining <= 0) return null
  return (remaining * (row.planMarginPct - row.actualMarginPct)) / 100
}
