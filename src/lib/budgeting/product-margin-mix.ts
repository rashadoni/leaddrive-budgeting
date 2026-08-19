/**
 * Why the group margin moved: rates or the basket? (2026-08-19)
 *
 * The comparison screen says the group margin came in below plan. That is two
 * completely different businesses depending on the cause, and the screen
 * cannot tell them apart:
 *
 *   RATE  — each product earned less than planned. A pricing or cost problem.
 *   MIX   — each product earned roughly what it should, but the company sold a
 *           different basket, weighted toward the thinner products. A demand or
 *           allocation problem.
 *
 * Measured on the client's own January–May: rates contributed +0.18 points and
 * mix contributed −3.76. Almost the entire shortfall is basket, not pricing —
 * malt was planned at 24.2% of revenue and delivered 15.3%, while its own
 * margin actually improved. A screen that only shows the total gap sends
 * someone to renegotiate prices that were never the problem.
 *
 * ## The identity, and why mix is measured against the plan average
 *
 * With `w` a product's revenue share and `m` its margin, the group margin is
 * `Σ w·m`. For products present on both sides the gap splits exactly:
 *
 *   gap = Σ wₐ(mₐ − m_b)  +  Σ (wₐ − w_b)(m_b − M_b)
 *          ↑ rate             ↑ mix
 *
 * The `− M_b` in the mix term is not cosmetic. Without it a product sitting
 * exactly on the plan's average margin would still show a mix contribution
 * whenever its weight moved, which is wrong: shifting weight between two
 * average products changes nothing. Subtracting the plan average is free at
 * the total level (the weight deltas sum to zero) and makes each product's
 * number mean "its weight moved, and it is better or worse than the average
 * plan".
 *
 * ## What cannot be attributed, and is therefore stated
 *
 * A product sold but not budgeted in this window has no planned margin to
 * value its weight against — cotton is exactly this on the client's data,
 * budgeted at ~0% of January–May revenue and delivering 11%. Splitting it
 * would mean inventing a plan for it. It goes to `unattributed` instead, with
 * its share, so the reader sees the size of what the split does not cover
 * rather than a decomposition that silently does not add up.
 *
 * Pure.
 */
import type { ComparedProduct } from "./product-margin-compare"

export interface MixRateProduct {
  productCode: string
  productName: string
  /** Revenue share of the budget side, 0–1. Null when absent from the budget. */
  budgetShare: number | null
  /** Revenue share of the actual side, 0–1. Null when absent from the actuals. */
  actualShare: number | null
  /** Margin points from this product earning more or less than planned. */
  ratePoints: number | null
  /** Margin points from this product taking a bigger or smaller share. */
  mixPoints: number | null
}

export interface MixRateDecomposition {
  products: MixRateProduct[]
  /** Total points explained by margins moving. */
  ratePoints: number
  /** Total points explained by the basket changing. */
  mixPoints: number
  /**
   * Points the split cannot assign — products on one side only. Zero on a
   * clean comparison; when it is not zero the reader is told, rather than
   * shown parts that quietly fail to sum to the whole.
   */
  unattributedPoints: number
  /** The gap being explained: actual group margin minus budget, in points. */
  gapPoints: number | null
}

/** Revenue that has a known margin behind it — the only revenue a share means anything over. */
function weighable(side: { revenue: number; marginPct: number | null } | null): boolean {
  return side !== null && side.marginPct !== null && side.revenue > 0
}

export function decomposeMixAndRate(
  products: ReadonlyArray<ComparedProduct>,
  groupBudgetMarginPct: number | null,
  groupActualMarginPct: number | null,
): MixRateDecomposition {
  const budgetBase = products.reduce((s, p) => s + (weighable(p.budget) ? p.budget!.revenue : 0), 0)
  const actualBase = products.reduce((s, p) => s + (weighable(p.actual) ? p.actual!.revenue : 0), 0)
  const M_b = groupBudgetMarginPct

  const rows: MixRateProduct[] = products.map((p) => {
    const budgetShare = weighable(p.budget) && budgetBase > 0 ? p.budget!.revenue / budgetBase : null
    const actualShare = weighable(p.actual) && actualBase > 0 ? p.actual!.revenue / actualBase : null
    // Both halves are needed to say anything: a rate move needs two margins,
    // and a weight move can only be valued against a planned margin.
    if (budgetShare === null || actualShare === null || M_b === null) {
      return { productCode: p.productCode, productName: p.productName, budgetShare, actualShare, ratePoints: null, mixPoints: null }
    }
    const mb = p.budget!.marginPct as number
    const ma = p.actual!.marginPct as number
    return {
      productCode: p.productCode,
      productName: p.productName,
      budgetShare,
      actualShare,
      ratePoints: actualShare * (ma - mb),
      mixPoints: (actualShare - budgetShare) * (mb - M_b),
    }
  })

  const ratePoints = rows.reduce((s, r) => s + (r.ratePoints ?? 0), 0)
  const mixPoints = rows.reduce((s, r) => s + (r.mixPoints ?? 0), 0)
  const gapPoints =
    groupActualMarginPct === null || groupBudgetMarginPct === null
      ? null
      : groupActualMarginPct - groupBudgetMarginPct

  return {
    products: rows,
    ratePoints,
    mixPoints,
    unattributedPoints: gapPoints === null ? 0 : gapPoints - ratePoints - mixPoints,
    gapPoints,
  }
}
