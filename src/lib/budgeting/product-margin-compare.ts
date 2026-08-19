/**
 * Budget against actual, per product, on the same months (2026-08-19).
 *
 * The margin screen can already say cotton keeps 1.1%. The budget said 28%.
 * Those two numbers currently live on two different plans, which means the
 * reader switches a selector and holds the first figure in their head — and
 * the one comparison the client actually asked for is the one the screen makes
 * hardest.
 *
 * ## The trap this exists to avoid
 *
 * The client's actuals stop in May; the budget runs the full year. Setting one
 * against the other compares five months of delivery with twelve months of
 * plan and calls the difference performance. Every figure would be wrong in
 * the same direction, which is the kind of wrong nobody catches by eye.
 *
 * So the caller restricts BOTH sides to the months the actual side actually
 * carries, and this module states that window back so the screen can print it.
 * Margins are ratios, so a shorter window is not a smaller number — but it is
 * a different one, and the reader is owed the period it belongs to.
 *
 * Pure: the caller supplies the two already-aggregated sides.
 */
import {
  buildProductMarginsFromAccounts,
  type AccountAmount,
} from "./product-margin-accounts"
import type { ProductMargin, ProductMarginReason } from "./product-margin"

export interface ComparedSide {
  revenue: number
  cost: number | null
  marginPct: number | null
  reason?: ProductMarginReason
}

export interface ComparedProduct {
  productCode: string
  productName: string
  budget: ComparedSide | null
  actual: ComparedSide | null
  /**
   * Actual margin minus budget margin, in percentage POINTS. Null whenever
   * either side is unknown — a gap against an unknown is not a small gap, and
   * showing 0 there would read as "on plan".
   */
  gapPoints: number | null
}

export interface BasketTotals {
  revenue: number
  cost: number
  grossProfit: number
  marginPct: number | null
}

export interface MarginComparison {
  products: ComparedProduct[]
  budget: { knownRevenue: number; knownCost: number; knownMarginPct: number | null }
  actual: { knownRevenue: number; knownCost: number; knownMarginPct: number | null }
  /**
   * Whole-basket gap: each side over its own set of products. Kept because it
   * reconciles to the P&L, but it is NOT the headline — see `common`.
   */
  gapPoints: number | null
  /**
   * Both sides restricted to the products that carry a known margin on BOTH.
   * This is the comparison a reader believes they are being shown.
   *
   * Measured on the client's January–May 2026: the whole-basket reading is
   * 25.1% against 21.6%, a gap of −3.6 points, and it is quoted as
   * performance. On the eight products present in both plans it is 25.1%
   * against 25.0% — one tenth of a point. The other 3.5 points are products
   * the plan does not contain in this window at all, and calling that a
   * margin miss sends someone to renegotiate prices that never moved.
   */
  common: {
    productCodes: string[]
    budget: BasketTotals
    actual: BasketTotals
    gapPoints: number | null
  }
  /**
   * Delivered against no plan in this window. Reported with its money rather
   * than folded into a percentage, because the reader's question about it is
   * "how much and at what rate", not "how many points".
   */
  outsidePlan: BasketTotals & {
    products: Array<{
      productCode: string
      productName: string
      revenue: number
      marginPct: number | null
    }>
  }
}

const EMPTY: BasketTotals = { revenue: 0, cost: 0, grossProfit: 0, marginPct: null }

function basket(sides: ReadonlyArray<ComparedSide>): BasketTotals {
  let revenue = 0
  let cost = 0
  for (const s of sides) {
    if (s.cost === null) continue
    revenue += s.revenue
    cost += s.cost
  }
  const grossProfit = revenue - cost
  return {
    revenue,
    cost,
    grossProfit,
    // Weighted by money, never the mean of the per-product percentages: a
    // 6,250 line would otherwise weigh as much as a 3.6M one.
    marginPct: revenue === 0 ? null : (grossProfit / revenue) * 100,
  }
}

function sideOf(p: ProductMargin | undefined): ComparedSide | null {
  if (!p) return null
  return {
    revenue: p.revenue,
    cost: p.cost,
    marginPct: p.marginPct,
    ...(p.reason ? { reason: p.reason } : {}),
  }
}

export function buildMarginComparison(
  budgetRows: ReadonlyArray<AccountAmount>,
  actualRows: ReadonlyArray<AccountAmount>,
): MarginComparison {
  const budget = buildProductMarginsFromAccounts(budgetRows)
  const actual = buildProductMarginsFromAccounts(actualRows)

  const byCode = new Map<string, { name: string; b?: ProductMargin; a?: ProductMargin }>()
  for (const p of budget.products) {
    byCode.set(p.productCode, { name: p.productName, b: p })
  }
  for (const p of actual.products) {
    const seen = byCode.get(p.productCode)
    if (seen) seen.a = p
    // Present in the actuals and absent from the budget: something is being
    // sold that nobody planned. That is worth showing, not dropping.
    else byCode.set(p.productCode, { name: p.productName, a: p })
  }

  const products: ComparedProduct[] = [...byCode.entries()]
    .map(([productCode, e]) => {
      const b = sideOf(e.b)
      const a = sideOf(e.a)
      return {
        productCode,
        productName: e.name,
        budget: b,
        actual: a,
        gapPoints:
          b?.marginPct == null || a?.marginPct == null ? null : a.marginPct - b.marginPct,
      }
    })
    // Biggest shortfall first: the reason to open this screen is to find what
    // is not delivering, so it should not have to be searched for.
    .sort((x, y) => {
      if (x.gapPoints === null && y.gapPoints === null) {
        return (y.actual?.revenue ?? 0) - (x.actual?.revenue ?? 0)
      }
      if (x.gapPoints === null) return 1
      if (y.gapPoints === null) return -1
      return x.gapPoints - y.gapPoints
    })

  const pick = (s: typeof budget) => ({
    knownRevenue: s.knownRevenue,
    knownCost: s.knownCost,
    knownMarginPct: s.knownMarginPct,
  })

  // Known on BOTH sides. `gapPoints !== null` is exactly that condition, so
  // the basket cannot drift from the per-product gaps shown beside it.
  const paired = products.filter((p) => p.gapPoints !== null)
  const commonBudget = basket(paired.map((p) => p.budget as ComparedSide))
  const commonActual = basket(paired.map((p) => p.actual as ComparedSide))

  const orphans = products.filter(
    (p) => p.gapPoints === null && p.actual != null && p.actual.marginPct !== null,
  )
  const orphanTotals = basket(orphans.map((p) => p.actual as ComparedSide))

  return {
    products,
    budget: pick(budget),
    actual: pick(actual),
    gapPoints:
      budget.knownMarginPct === null || actual.knownMarginPct === null
        ? null
        : actual.knownMarginPct - budget.knownMarginPct,
    common: {
      productCodes: paired.map((p) => p.productCode),
      budget: commonBudget,
      actual: commonActual,
      gapPoints:
        commonBudget.marginPct === null || commonActual.marginPct === null
          ? null
          : commonActual.marginPct - commonBudget.marginPct,
    },
    outsidePlan: {
      ...(orphans.length === 0 ? EMPTY : orphanTotals),
      products: orphans.map((p) => ({
        productCode: p.productCode,
        productName: p.productName,
        revenue: p.actual?.revenue ?? 0,
        marginPct: p.actual?.marginPct ?? null,
      })),
    },
  }
}
