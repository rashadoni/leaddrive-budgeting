/**
 * Phase 3.1 v1.2 — pure helper extracted from `/api/budgeting/analytics`
 * route. Given a budget plan (annual / quarterly / monthly) and the
 * current Baku-time year+month, returns the array of 0-indexed month
 * positions that have ELAPSED inside the plan's period. The variance
 * sparkline's auto-actual overlay attributes one `monthlyAmount` per
 * elapsed month, so this list directly drives that bucket-by-month
 * fan-out.
 *
 * Annual plan: elapsed months are 0..min(11, curMonth-1) if curYear ===
 * plan.year, the full 0..11 if curYear > plan.year, empty otherwise.
 *
 * Quarterly plan: elapsed months span from qStart-1..min(curMonth-1,
 * qEnd-1) when we're inside the quarter, full Q if past, empty if
 * before.
 *
 * Monthly plan: a single `[plan.month - 1]` slot (matches the actual
 * elapsed counter which is always 1 for an in-progress monthly plan).
 */
export type PlanPeriodInput = {
  periodType: "monthly" | "quarterly" | "annual" | string
  year: number
  quarter?: number | null
  month?: number | null
}

export function computeElapsedMonthIndices(
  plan: PlanPeriodInput,
  currentYear: number,
  currentMonth: number, // 1-indexed
): number[] {
  if (plan.periodType === "monthly") {
    if (plan.month && plan.month >= 1 && plan.month <= 12) {
      return [plan.month - 1]
    }
    return []
  }

  if (plan.periodType === "quarterly" && plan.quarter) {
    const qStart = (plan.quarter - 1) * 3 + 1
    const qEnd = qStart + 2
    // Quarter fully completed (past year, or past month within plan year)
    if (currentYear > plan.year || (currentYear === plan.year && currentMonth > qEnd)) {
      const out: number[] = []
      for (let m = qStart; m <= qEnd; m++) out.push(m - 1)
      return out
    }
    // Inside the quarter
    if (currentYear === plan.year && currentMonth >= qStart) {
      const out: number[] = []
      for (let m = qStart; m <= currentMonth; m++) out.push(m - 1)
      return out
    }
    // Quarter hasn't started yet
    return []
  }

  if (plan.periodType === "annual") {
    if (currentYear > plan.year) {
      return Array.from({ length: 12 }, (_, i) => i)
    }
    if (currentYear === plan.year) {
      const out: number[] = []
      for (let m = 1; m <= Math.min(12, currentMonth); m++) out.push(m - 1)
      return out
    }
    return []
  }

  // Unknown periodType — defensive empty.
  return []
}
