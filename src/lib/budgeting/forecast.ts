/**
 * Budget Forecast Engine
 *
 * Produces a 12-month projection from:
 * 1. Actual data YTD (from cost model or manual actuals)
 * 2. Budget plan amount as the ceiling/reference
 * 3. Linear extrapolation from actuals YTD for remaining months
 * 4. DB overrides from BudgetForecastEntry (user-confirmed or generated)
 * 5. Scenario multipliers (base / optimistic / pessimistic)
 */

export type ScenarioType = "base" | "optimistic" | "pessimistic"

export interface MonthlyDataPoint {
  month: number     // 1-12
  year: number
  label: string     // "Jan", "Feb", ...
  planned: number
  forecast: number
  actual: number    // 0 if not yet recorded
  isProjected: boolean // true for future months
  isOverride: boolean  // true if forecast came from DB entry
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * Build a 12-month forecast projection.
 *
 * @param year             The budget year
 * @param totalPlanned     Full-year planned budget
 * @param totalActual      YTD actual (from cost model or manual)
 * @param currentMonth     Current month (1-12), actuals available up to this month
 * @param monthlyActuals   Optional map: month → actual amount (if known per-month)
 * @param monthlyPlanned   Optional map: month → planned amount per month
 * @param overrides        Optional map: month → forecast from BudgetForecastEntry DB records
 */
export function buildMonthlyForecast(
  year: number,
  totalPlanned: number,
  totalActual: number,
  currentMonth: number,
  monthlyActuals?: Map<number, number>,
  monthlyPlanned?: Map<number, number>,
  overrides?: Map<number, number>,
): MonthlyDataPoint[] {
  const points: MonthlyDataPoint[] = []

  // Monthly planned = even distribution if no per-month breakdown
  const defaultMonthlyPlanned = totalPlanned / 12

  // Actual run rate per month based on YTD
  const actualRunRate = currentMonth > 0 ? totalActual / currentMonth : 0

  for (let m = 1; m <= 12; m++) {
    const planned = monthlyPlanned?.get(m) ?? defaultMonthlyPlanned
    const isPast = m <= currentMonth
    const hasOverride = overrides?.has(m) ?? false

    // Actual: use known per-month data, or distribute evenly
    const actual = isPast
      ? (monthlyActuals?.get(m) ?? actualRunRate)
      : 0

    // Forecast priority: DB override > past actual > extrapolation > plan
    let forecast: number
    if (hasOverride) {
      forecast = overrides!.get(m)!
    } else if (isPast) {
      forecast = actual
    } else if (actualRunRate > 0) {
      forecast = actualRunRate
    } else {
      forecast = planned
    }

    points.push({
      month: m,
      year,
      label: MONTH_LABELS[m - 1],
      planned: Math.round(planned),
      forecast: Math.round(forecast),
      actual: isPast ? Math.round(actual) : 0,
      isProjected: !isPast,
      isOverride: hasOverride,
    })
  }

  return points
}

/**
 * Build per-category monthly forecast entries for bulk generation.
 * Returns an array of { category, month, year, forecastAmount } ready for DB upsert.
 */
export function buildCategoryForecast(
  categories: Array<{ category: string; plannedAmount: number; lineType: string }>,
  year: number,
  totalActual: number,
  currentMonth: number,
  periodMonths = 12,
): Array<{ category: string; month: number; year: number; forecastAmount: number }> {
  const entries: Array<{ category: string; month: number; year: number; forecastAmount: number }> = []
  const totalPlanned = categories.reduce((s, c) => s + c.plannedAmount, 0)

  for (const cat of categories) {
    const weight = totalPlanned > 0 ? cat.plannedAmount / totalPlanned : 1 / categories.length
    const catActual = totalActual * weight
    const catRunRate = currentMonth > 0 ? catActual / currentMonth : 0
    const catMonthlyPlan = cat.plannedAmount / periodMonths

    for (let m = 1; m <= 12; m++) {
      const isPast = m <= currentMonth
      const forecastAmount = isPast
        ? catRunRate
        : catRunRate > 0 ? catRunRate : catMonthlyPlan

      entries.push({
        category: cat.category,
        month: m,
        year,
        forecastAmount: Math.round(forecastAmount * 100) / 100,
      })
    }
  }

  return entries
}

/**
 * Apply scenario multipliers to forecast data.
 * Base = 1.0x, Optimistic = -10% expenses / +10% revenue, Pessimistic = +15% expenses / -10% revenue
 */
export function applyScenario(
  points: MonthlyDataPoint[],
  scenario: ScenarioType,
  lineType: "expense" | "revenue" | "mixed" = "mixed",
): MonthlyDataPoint[] {
  if (scenario === "base") return points

  return points.map(p => {
    if (!p.isProjected && !p.isOverride) return p // Don't modify past actuals

    let multiplier = 1.0
    if (scenario === "optimistic") {
      multiplier = lineType === "revenue" ? 1.10 : lineType === "expense" ? 0.90 : 0.95
    } else { // pessimistic
      multiplier = lineType === "revenue" ? 0.90 : lineType === "expense" ? 1.15 : 1.10
    }

    return {
      ...p,
      forecast: Math.round(p.forecast * multiplier),
    }
  })
}

/**
 * Calculate year-end projection from YTD actuals.
 * Simple linear extrapolation: (actual / monthsElapsed) * totalMonths
 */
export function calcYearEndProjection(totalActual: number, currentMonth: number, totalMonths = 12): number {
  if (currentMonth <= 0) return 0
  return (totalActual / currentMonth) * totalMonths
}

/**
 * Variance analysis: compute price/volume decomposition
 * For FP&A: planned vs forecast vs actual
 */
export interface VarianceSummary {
  budgetVsForecast: number  // Forecast deviation from budget
  budgetVsActual: number    // Actual deviation from budget
  forecastVsActual: number  // Actual vs forecast
  budgetVsActualPct: number
  yearEndGap: number        // year-end projection vs budget
  isOnTrack: boolean        // actual within 10% of budget
}

export function computeVarianceSummary(
  totalPlanned: number,
  totalForecast: number,
  totalActual: number,
  yearEndProjection: number,
): VarianceSummary {
  const budgetVsForecast = totalPlanned - totalForecast
  const budgetVsActual = totalPlanned - totalActual
  const forecastVsActual = totalForecast - totalActual
  const budgetVsActualPct = totalPlanned > 0 ? (budgetVsActual / totalPlanned) * 100 : 0
  const yearEndGap = totalPlanned - yearEndProjection
  const isOnTrack = Math.abs(budgetVsActualPct) <= 10

  return {
    budgetVsForecast,
    budgetVsActual,
    forecastVsActual,
    budgetVsActualPct,
    yearEndGap,
    isOnTrack,
  }
}
