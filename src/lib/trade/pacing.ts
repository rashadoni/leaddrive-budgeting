// Phase 9.7 — Trade pacing engine: transparent run-rate math, NO AI.
// Design: docs/TRADE_SPEND_CONTROL_TOWER_PLAN.md §4 "Pacing math".
//
// Everything here is a pure function of its inputs so finance can audit
// the arithmetic by hand; the persisted TradePacingSnapshot stores the
// full `math` object next to the result. The canonical example:
// "Day 20: 82% of budget spent but only 61% of sales plan achieved."

export type TradeRiskStatus = "ok" | "watch" | "high" | "critical";

/**
 * Per-weekday sales weights, index 0 = Sunday … 6 = Saturday.
 * Default (ASSUMPTION — replace with the customer's route calendar when
 * A5 data arrives): DSD trade runs Mon-Sat full, Sunday at half weight.
 */
export const DEFAULT_WEEKDAY_WEIGHTS: readonly number[] = [0.5, 1, 1, 1, 1, 1, 1];

export interface PacingThresholds {
  /** forecast overrun as % of month budget → status floor. */
  overrunPctWatch: number;
  overrunPctHigh: number;
  overrunPctCritical: number;
  /** spend-progress minus sales-progress, percentage points. */
  paceGapPpWatch: number;
  paceGapPpHigh: number;
  paceGapPpCritical: number;
}

/** Documented defaults — overridable per org later (settings blob). */
export const DEFAULT_PACING_THRESHOLDS: PacingThresholds = {
  overrunPctWatch: 0,
  overrunPctHigh: 5,
  overrunPctCritical: 15,
  paceGapPpWatch: 8,
  paceGapPpHigh: 15,
  paceGapPpCritical: 25,
};

function daysInMonth(year: number, month: number): number {
  // month is 1-12; day 0 of next month = last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weightOf(year: number, month: number, day: number, weights: readonly number[]): number {
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weights[dow] ?? 1;
}

/** Total working-day weight of a month (month: 1-12). */
export function monthWeight(
  year: number,
  month: number,
  weights: readonly number[] = DEFAULT_WEEKDAY_WEIGHTS
): number {
  let sum = 0;
  for (let d = 1; d <= daysInMonth(year, month); d++) sum += weightOf(year, month, d, weights);
  return sum;
}

/** Working-day weight from the 1st through `throughDay` inclusive (clamped). */
export function elapsedWeight(
  year: number,
  month: number,
  throughDay: number,
  weights: readonly number[] = DEFAULT_WEEKDAY_WEIGHTS
): number {
  const last = Math.min(Math.max(throughDay, 0), daysInMonth(year, month));
  let sum = 0;
  for (let d = 1; d <= last; d++) sum += weightOf(year, month, d, weights);
  return sum;
}

/**
 * Spread a monthly plan amount over the month's days by weekday weight.
 * Returns one entry per calendar day; amounts sum to `monthAmount`
 * (last day absorbs the rounding remainder). Used to materialize
 * TradePlanDaily rows.
 */
export function spreadMonthlyPlan(
  year: number,
  month: number,
  monthAmount: number,
  weights: readonly number[] = DEFAULT_WEEKDAY_WEIGHTS
): { day: number; weight: number; amount: number }[] {
  const total = monthWeight(year, month, weights);
  const days = daysInMonth(year, month);
  const out: { day: number; weight: number; amount: number }[] = [];
  let allocated = 0;
  for (let d = 1; d <= days; d++) {
    const w = weightOf(year, month, d, weights);
    const raw = total > 0 ? (monthAmount * w) / total : 0;
    const amount = d === days ? monthAmount - allocated : Math.round(raw * 100) / 100;
    allocated = Math.round((allocated + amount) * 100) / 100;
    out.push({ day: d, weight: w, amount });
  }
  return out;
}

export interface PacingInput {
  /** Month being paced. */
  year: number;
  month: number; // 1-12
  /** Day of month the data is complete through (the "as of" day). */
  asOfDay: number;
  /** Full-month sales plan (AZN). */
  salesPlanMonth: number;
  /** Month-to-date actual net sales (AZN). */
  salesActualMtd: number;
  /** Full-month trade budget (AZN). */
  budgetMonth: number;
  /**
   * Month-to-date CONTROL spend — accrued for committed-before-settlement
   * types, actual for payment-gated ones (see controlKindForAccrualMethod).
   */
  controlSpendMtd: number;
  /** Shown separately in every UI; carried into the snapshot. */
  accruedSpendMtd: number;
  actualSpendMtd: number;
  weights?: readonly number[];
  thresholds?: PacingThresholds;
}

export interface PacingResult {
  /** 0..1 share of the month's working weight that has elapsed. */
  elapsedShare: number;
  /** Working-day-weighted MTD sales plan (AZN). */
  salesPlanMtd: number;
  /** salesActualMtd / salesPlanMtd (%; null when plan MTD is 0). */
  salesAchievementPct: number | null;
  /** salesActualMtd / salesPlanMonth (%; progress vs FULL month). */
  salesProgressPct: number | null;
  /** controlSpendMtd / budgetMonth (%; null when budget is 0). */
  spendProgressPct: number | null;
  /** Run-rate month-end projections (null before any weight elapses). */
  forecastSalesMonth: number | null;
  forecastSpendMonth: number | null;
  forecastBudgetVariance: number | null; // AZN; positive = overrun
  forecastBudgetVariancePct: number | null; // % of budgetMonth
  forecastSalesGap: number | null; // AZN; negative = plan shortfall
  /** spendProgressPct - salesProgressPct, percentage points. */
  paceGapPp: number | null;
  riskStatus: TradeRiskStatus;
  /** "empty" = no plan AND no budget; "partial" = one of them missing. */
  dataQuality: "complete" | "partial" | "empty";
  /**
   * T3 (audit §1.5) — true when a sales plan exists but zero actuals were
   * fed (the 9.5 daily feed is not connected). While pending, the pace
   * gap is EXCLUDED from risk classification — a chip that is always
   * yellow trains users to ignore chips.
   */
  salesFeedPending: boolean;
  /** Every input + intermediate, persisted for hand-audit. */
  math: Record<string, number | null>;
}

const pct = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 10000) / 100 : null;

export function computePacing(input: PacingInput): PacingResult {
  const weights = input.weights ?? DEFAULT_WEEKDAY_WEIGHTS;
  const thresholds = input.thresholds ?? DEFAULT_PACING_THRESHOLDS;

  const totalWeight = monthWeight(input.year, input.month, weights);
  const elapsed = elapsedWeight(input.year, input.month, input.asOfDay, weights);
  const elapsedShare = totalWeight > 0 ? elapsed / totalWeight : 0;

  const salesPlanMtd = input.salesPlanMonth * elapsedShare;
  const salesAchievementPct = pct(input.salesActualMtd, salesPlanMtd);
  const salesProgressPct = pct(input.salesActualMtd, input.salesPlanMonth);
  const spendProgressPct = pct(input.controlSpendMtd, input.budgetMonth);

  const canForecast = elapsedShare > 0;
  const forecastSalesMonth = canForecast ? input.salesActualMtd / elapsedShare : null;
  const forecastSpendMonth = canForecast ? input.controlSpendMtd / elapsedShare : null;
  const forecastBudgetVariance =
    forecastSpendMonth != null ? forecastSpendMonth - input.budgetMonth : null;
  const forecastBudgetVariancePct =
    forecastBudgetVariance != null && input.budgetMonth > 0
      ? Math.round((forecastBudgetVariance / input.budgetMonth) * 10000) / 100
      : null;
  const forecastSalesGap =
    forecastSalesMonth != null ? forecastSalesMonth - input.salesPlanMonth : null;

  const paceGapPp =
    spendProgressPct != null && salesProgressPct != null
      ? Math.round((spendProgressPct - salesProgressPct) * 100) / 100
      : null;

  const hasPlan = input.salesPlanMonth > 0;
  const hasBudget = input.budgetMonth > 0;
  const dataQuality: PacingResult["dataQuality"] =
    hasPlan && hasBudget ? "complete" : hasPlan || hasBudget ? "partial" : "empty";
  const salesFeedPending = hasPlan && input.salesActualMtd === 0;

  let riskStatus: TradeRiskStatus = "ok";
  if (dataQuality !== "empty") {
    const overrun = forecastBudgetVariancePct ?? -Infinity;
    const gap = salesFeedPending ? -Infinity : (paceGapPp ?? -Infinity);
    if (overrun >= thresholds.overrunPctCritical || gap >= thresholds.paceGapPpCritical) {
      riskStatus = "critical";
    } else if (overrun >= thresholds.overrunPctHigh || gap >= thresholds.paceGapPpHigh) {
      riskStatus = "high";
    } else if (overrun > thresholds.overrunPctWatch || gap >= thresholds.paceGapPpWatch) {
      riskStatus = "watch";
    }
  }

  return {
    elapsedShare: Math.round(elapsedShare * 10000) / 10000,
    salesPlanMtd: Math.round(salesPlanMtd * 100) / 100,
    salesAchievementPct,
    salesProgressPct,
    spendProgressPct,
    forecastSalesMonth: forecastSalesMonth != null ? Math.round(forecastSalesMonth * 100) / 100 : null,
    forecastSpendMonth: forecastSpendMonth != null ? Math.round(forecastSpendMonth * 100) / 100 : null,
    forecastBudgetVariance:
      forecastBudgetVariance != null ? Math.round(forecastBudgetVariance * 100) / 100 : null,
    forecastBudgetVariancePct,
    forecastSalesGap: forecastSalesGap != null ? Math.round(forecastSalesGap * 100) / 100 : null,
    paceGapPp,
    riskStatus,
    dataQuality,
    salesFeedPending,
    math: {
      year: input.year,
      month: input.month,
      asOfDay: input.asOfDay,
      totalWeight: Math.round(totalWeight * 100) / 100,
      elapsedWeight: Math.round(elapsed * 100) / 100,
      salesPlanMonth: input.salesPlanMonth,
      salesActualMtd: input.salesActualMtd,
      budgetMonth: input.budgetMonth,
      controlSpendMtd: input.controlSpendMtd,
      accruedSpendMtd: input.accruedSpendMtd,
      actualSpendMtd: input.actualSpendMtd,
    },
  };
}
