/**
 * Gross margin per product — and, just as importantly, the products whose
 * margin nobody knows (2026-08-18).
 *
 * The owner asked for exactly this: `(revenue − cogs) / revenue`, with wheat,
 * cotton and the rest stated separately rather than folded into one group
 * number. The group number hides what matters — on the client's own data,
 * glucose sold at home earns 47.1% while the same glucose exported earns
 * 16.5%, and a by-product leaves at cost. One consolidated 30.7% says none of
 * that.
 *
 * ## Why `null` is a first-class answer here
 *
 * Half the client's products have no cost data at all: the processing sheets
 * carry a `COGS` block, the farming sheets carry tonnes and no money. Those
 * are the two products the owner named first — wheat and cotton — so the
 * unknown case is not an edge case, it is half the screen.
 *
 * A missing cost must therefore never become a zero. Zero cost renders as a
 * 100% margin, which is a fabrication that looks exactly like an excellent
 * result; the reader has no way to tell it from a real one. `marginPct: null`
 * plus a `reason` lets the surface say "no cost data" and stay honest, which
 * is the same rule the import follows when it declines to invent a cost.
 *
 * Pure: the caller supplies rows it already has, nothing here queries.
 */

/** One product's revenue and (maybe) cost for the period being shown. */
export interface ProductMarginInput {
  productCode: string
  productName: string
  /** Net revenue over the period. */
  revenue: number
  /**
   * Cost over the period, or `undefined` when the source stated none.
   * `0` means the source stated zero — a by-product sold at cost is a real
   * answer and must not be confused with silence.
   */
  cost?: number
}

export type ProductMarginReason =
  /** The source states no cost for this product (farming, in this workbook). */
  | "no_cost_data"
  /** Cost is known but revenue is zero, so the ratio has no denominator. */
  | "no_revenue"
  /**
   * Revenue is NEGATIVE, so the ratio has a denominator that inverts it.
   *
   * Elimination rows carry negative revenue and negative cost — measured on
   * production, 2025 corn eliminates at −7,346,866 of revenue against
   * −4,861,905 of cost, and the formula returns a confident-looking +33.8%
   * built from two minuses. Nothing about that number is true, and unlike an
   * absurd figure it does not announce itself.
   *
   * The amounts stay in the group totals, where they belong and where they
   * reconcile to the P&L; only the per-product ratio is withheld.
   */
  | "negative_revenue"
  /**
   * A cost account exists for this product and sums to exactly zero, which
   * arithmetic turns into a 100% margin. Nothing in this business sells at
   * 100% gross margin, so a zero here means the costs were not posted, not
   * that they were nil — measured case: Farming Services, 6,250 of revenue
   * against a cost account summing to 0, rendering as "100.0%".
   *
   * The cost is still reported as 0 (that IS what the books say); only the
   * RATIO is withheld. A genuinely costless product would be misreported by
   * this rule, and that is the intended trade: a withheld ratio sends someone
   * to check the mapping, while a 100% margin sends them nowhere.
   */
  | "zero_cost"

export interface ProductMargin {
  productCode: string
  productName: string
  revenue: number
  /** Null when unknown — see `reason`. Never silently zero. */
  cost: number | null
  /** Absolute gross profit, null whenever cost is unknown. */
  grossProfit: number | null
  /** `(revenue − cost) / revenue × 100`, null when it cannot be computed. */
  marginPct: number | null
  /** Present exactly when `marginPct` is null; the surface renders this. */
  reason?: ProductMarginReason
}

export interface ProductMarginSummary {
  products: ProductMargin[]
  /**
   * Group margin over the products that HAVE cost data — never over all of
   * them, or the products with no cost would silently inflate it toward 100%.
   */
  knownRevenue: number
  knownCost: number
  knownMarginPct: number | null
  /**
   * How much revenue has no cost behind it. The number that tells a reader
   * how much of the business this screen cannot speak for — on the client's
   * 2026 data that is the whole farming side.
   */
  revenueWithoutCost: number
}

function marginOf(input: ProductMarginInput): ProductMargin {
  const base = {
    productCode: input.productCode,
    productName: input.productName,
    revenue: input.revenue,
  }
  if (input.cost === undefined) {
    return { ...base, cost: null, grossProfit: null, marginPct: null, reason: "no_cost_data" }
  }
  const grossProfit = input.revenue - input.cost
  if (input.revenue === 0) {
    // Cost with no revenue: the profit is real (negative), the RATIO is not.
    return { ...base, cost: input.cost, grossProfit, marginPct: null, reason: "no_revenue" }
  }
  if (input.revenue < 0) {
    // See `negative_revenue`. A sign-flipped ratio is worse than none.
    return { ...base, cost: input.cost, grossProfit, marginPct: null, reason: "negative_revenue" }
  }
  if (input.cost === 0) {
    // See `zero_cost`. Money kept, ratio withheld.
    return { ...base, cost: 0, grossProfit, marginPct: null, reason: "zero_cost" }
  }
  return {
    ...base,
    cost: input.cost,
    grossProfit,
    marginPct: (grossProfit / input.revenue) * 100,
  }
}

export function summarizeProductMargins(
  rows: ReadonlyArray<ProductMarginInput>,
): ProductMarginSummary {
  const products = rows.map(marginOf)
  let knownRevenue = 0
  let knownCost = 0
  let revenueWithoutCost = 0
  for (const p of products) {
    // A cost we do not believe must not enter the group ratio. `no_revenue`
    // stays in: its cost is real and belongs in the group's numerator, it
    // simply has no denominator of its own.
    if (p.cost === null || p.reason === "zero_cost") {
      revenueWithoutCost += p.revenue
      continue
    }
    knownRevenue += p.revenue
    knownCost += p.cost
  }
  return {
    products,
    knownRevenue,
    knownCost,
    knownMarginPct:
      knownRevenue === 0 ? null : ((knownRevenue - knownCost) / knownRevenue) * 100,
    revenueWithoutCost,
  }
}
