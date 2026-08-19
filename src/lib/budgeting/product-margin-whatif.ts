/**
 * "What would it take?" — margin under a price and cost move (2026-08-19).
 *
 * The margin table answers what each product earns. The question it provokes
 * is the next one: cotton keeps 1.1% against a budget that assumed 28% — how
 * much price would close that, or how much cost? This turns the table into
 * something you can push on.
 *
 * ## Two rules this shares with `product-margin.ts`
 *
 * A product whose cost is unknown stays unknown under every simulation. There
 * is no honest way to scale a number nobody has, and inventing one here would
 * be worse than in the base table: the reader is now actively exploring and
 * more likely to trust what moves.
 *
 * The group figures are recomputed over products with known costs only, for
 * the same reason they are in the base table — otherwise dragging a slider
 * would silently pull revenue with no cost behind it into the average.
 *
 * ## Why there is no volume slider
 *
 * At a constant price and unit cost, gross margin PERCENT does not move with
 * volume — revenue and cost scale together and the ratio is unchanged. A
 * volume knob on this screen would look like it should do something and then
 * sit still, which teaches the reader the screen is broken. Volume belongs on
 * a mix or contribution view, where changing one product's weight really does
 * move the group number.
 *
 * Pure: no fetching, no persistence. Nothing here is ever written back.
 */
import type { ProductMargin } from "./product-margin"

/** Slider positions, as fractions: `0.1` is "ten percent higher". */
export interface MarginKnobs {
  price: number
  cost: number
}

export const NO_CHANGE: MarginKnobs = { price: 0, cost: 0 }

export function isSimulating(knobs: MarginKnobs): boolean {
  return knobs.price !== 0 || knobs.cost !== 0
}

export interface SimulatedProductMargin extends ProductMargin {
  /** Null exactly when the base figure is null — see the header. */
  simRevenue: number
  simCost: number | null
  simGrossProfit: number | null
  simMarginPct: number | null
}

export interface SimulatedSummary {
  products: SimulatedProductMargin[]
  knownRevenue: number
  knownCost: number
  knownMarginPct: number | null
}

export function simulateProductMargins(
  products: ReadonlyArray<ProductMargin>,
  knobs: MarginKnobs,
): SimulatedSummary {
  const simulated = products.map((p): SimulatedProductMargin => {
    const simRevenue = p.revenue * (1 + knobs.price)
    if (p.cost === null) {
      return { ...p, simRevenue, simCost: null, simGrossProfit: null, simMarginPct: null }
    }
    const simCost = p.cost * (1 + knobs.cost)
    const simGrossProfit = simRevenue - simCost
    return {
      ...p,
      simRevenue,
      simCost,
      simGrossProfit,
      // A ratio with no denominator stays absent, exactly as in the base table.
      simMarginPct: simRevenue === 0 ? null : (simGrossProfit / simRevenue) * 100,
    }
  })

  let knownRevenue = 0
  let knownCost = 0
  for (const p of simulated) {
    if (p.simCost === null) continue
    knownRevenue += p.simRevenue
    knownCost += p.simCost
  }

  return {
    products: simulated,
    knownRevenue,
    knownCost,
    knownMarginPct:
      knownRevenue === 0 ? null : ((knownRevenue - knownCost) / knownRevenue) * 100,
  }
}

/**
 * The price change that would put this product ON `targetPct`, holding cost.
 *
 * Solves `(r' − c) / r' = m` for `r'`, which gives `r' = c / (1 − m)`, and
 * returns the change as a fraction of today's revenue. Positive means "raise
 * the price by this much".
 *
 * Null when the question has no answer rather than an inconvenient one:
 * unknown cost, no revenue to change, or a target of 100% or more, which no
 * finite price reaches while any cost remains.
 */
export function priceUpliftForTarget(
  revenue: number,
  cost: number | null,
  targetPct: number,
): number | null {
  if (cost === null || revenue <= 0) return null
  const m = targetPct / 100
  if (m >= 1) return null
  const required = cost / (1 - m)
  return required / revenue - 1
}

/**
 * The cost change that would put this product on `targetPct`, holding price.
 * Negative means "cut cost by this much".
 */
export function costCutForTarget(
  revenue: number,
  cost: number | null,
  targetPct: number,
): number | null {
  if (cost === null || cost <= 0 || revenue <= 0) return null
  const allowed = revenue * (1 - targetPct / 100)
  return allowed / cost - 1
}
