/**
 * Where the year lands (2026-08-19).
 *
 * The client's actuals stop in May and the budget runs to December, so the
 * question nobody could answer from any existing screen is the owner's first
 * one: are we going to make the year?
 *
 * Method, chosen by the owner: **actual to date, plan for the rest.** The
 * months already closed are taken as delivered; the months ahead are taken at
 * budget. It reads as "if the rest goes to plan", and it keeps the seasonality
 * the budget already encodes — which matters here, because this is farming and
 * a run-rate off January–May would smear pre-harvest months across the whole
 * year and call it a forecast.
 *
 * ## The property this method has, which the screen must say out loud
 *
 * Under this method the projected full-year variance is EXACTLY the variance
 * already banked:
 *
 *   landing − budget = (ytdActual + restBudget) − (ytdBudget + restBudget)
 *                    = ytdActual − ytdBudget
 *
 * The remaining months are identical on both sides and cancel. So the number
 * is not a prediction of anything new: it is the miss to date, carried to
 * December. That is genuinely useful — it puts a year-scale figure on a
 * five-month gap — but a reader who thinks it is a model of the future will
 * over-trust it, so `varianceIsBankedOnly` says so in the payload rather than
 * leaving it to be discovered.
 *
 * EBITDA and the rest are composed by `computeEbitda`, the same function the
 * P&L screen uses, so the landing cannot disagree with the statement it is
 * projecting from.
 *
 * Pure.
 */
import { computeEbitda, type EbitdaBreakdown, type PnlSectionTotals } from "./ebitda"

export interface YearEndInputs {
  /** Delivered: the months that have actuals. */
  actualToDate: PnlSectionTotals
  /** The same months, at budget — the basis of the gap already banked. */
  budgetToDate: PnlSectionTotals
  /** The months still ahead, at budget. */
  budgetRemaining: PnlSectionTotals
  /** 1-based calendar months with actuals, for the screen to state. */
  monthsActual: number[]
  /** 1-based calendar months still to come. */
  monthsRemaining: number[]
}

export interface YearEndSide {
  totals: PnlSectionTotals
  derived: EbitdaBreakdown
}

export interface YearEndLanding {
  /** Actual to date plus budget for the rest. */
  landing: YearEndSide
  /** The year as originally planned, for comparison. */
  originalBudget: YearEndSide
  /** What has actually been delivered so far. */
  toDate: YearEndSide
  variance: {
    revenue: number
    ebitda: number
    netProfit: number
  }
  monthsActual: number[]
  monthsRemaining: number[]
  /**
   * True whenever the method is "plan for the rest", which makes the projected
   * variance identical to the variance already banked. Kept as a flag rather
   * than a comment so the surface is obliged to render the caveat.
   */
  varianceIsBankedOnly: true
}

function add(a: PnlSectionTotals, b: PnlSectionTotals): PnlSectionTotals {
  return {
    totalRevenue: a.totalRevenue + b.totalRevenue,
    totalCogs: a.totalCogs + b.totalCogs,
    totalOpex: a.totalOpex + b.totalOpex,
    totalOtherOperating: (a.totalOtherOperating ?? 0) + (b.totalOtherOperating ?? 0),
    totalBelowEbitda: a.totalBelowEbitda + b.totalBelowEbitda,
    daInCogs: a.daInCogs + b.daInCogs,
    daInOpex: a.daInOpex + b.daInOpex,
  }
}

function side(totals: PnlSectionTotals): YearEndSide {
  return { totals, derived: computeEbitda(totals) }
}

export function projectYearEnd(input: YearEndInputs): YearEndLanding {
  const landing = side(add(input.actualToDate, input.budgetRemaining))
  const originalBudget = side(add(input.budgetToDate, input.budgetRemaining))
  const toDate = side(input.actualToDate)

  return {
    landing,
    originalBudget,
    toDate,
    variance: {
      revenue: landing.totals.totalRevenue - originalBudget.totals.totalRevenue,
      ebitda: landing.derived.ebitda - originalBudget.derived.ebitda,
      netProfit: landing.derived.netProfit - originalBudget.derived.netProfit,
    },
    monthsActual: [...input.monthsActual].sort((a, b) => a - b),
    monthsRemaining: [...input.monthsRemaining].sort((a, b) => a - b),
    varianceIsBankedOnly: true,
  }
}
