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

export interface MarginComparison {
  products: ComparedProduct[]
  budget: { knownRevenue: number; knownCost: number; knownMarginPct: number | null }
  actual: { knownRevenue: number; knownCost: number; knownMarginPct: number | null }
  /** Group margin gap in percentage points, null if either side has none. */
  gapPoints: number | null
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

  return {
    products,
    budget: pick(budget),
    actual: pick(actual),
    gapPoints:
      budget.knownMarginPct === null || actual.knownMarginPct === null
        ? null
        : actual.knownMarginPct - budget.knownMarginPct,
  }
}
