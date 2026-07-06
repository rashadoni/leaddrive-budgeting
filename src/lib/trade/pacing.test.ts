import { describe, expect, it } from "vitest";

import {
  DEFAULT_PACING_THRESHOLDS,
  DEFAULT_WEEKDAY_WEIGHTS,
  computePacing,
  elapsedWeight,
  monthWeight,
  spreadMonthlyPlan,
} from "./pacing";

// Uniform weights make the arithmetic exact in tests.
const UNIFORM = [1, 1, 1, 1, 1, 1, 1] as const;

describe("monthWeight / elapsedWeight", () => {
  it("August 2026 with default weights: 5 Sundays at 0.5", () => {
    // Aug 2026: 31 days, Sundays on 2/9/16/23/30.
    expect(monthWeight(2026, 8, DEFAULT_WEEKDAY_WEIGHTS)).toBe(26 + 5 * 0.5);
  });

  it("elapsed through day 10 counts partial Sundays", () => {
    // Days 1-10 contain Sundays 2 and 9.
    expect(elapsedWeight(2026, 8, 10, DEFAULT_WEEKDAY_WEIGHTS)).toBe(8 + 2 * 0.5);
  });

  it("clamps out-of-range days", () => {
    expect(elapsedWeight(2026, 8, 99, UNIFORM)).toBe(31);
    expect(elapsedWeight(2026, 8, 0, UNIFORM)).toBe(0);
  });
});

describe("spreadMonthlyPlan", () => {
  it("sums exactly to the month amount (last day absorbs rounding)", () => {
    const rows = spreadMonthlyPlan(2026, 8, 100000, DEFAULT_WEEKDAY_WEIGHTS);
    expect(rows).toHaveLength(31);
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(100000);
  });

  it("weights Sundays lower", () => {
    const rows = spreadMonthlyPlan(2026, 8, 28500, DEFAULT_WEEKDAY_WEIGHTS);
    const sunday = rows.find((r) => r.day === 2)!; // Sun
    const monday = rows.find((r) => r.day === 3)!; // Mon
    expect(sunday.amount).toBeCloseTo(monday.amount / 2, 5);
  });
});

describe("computePacing — the canonical day-20 example", () => {
  // "Day 20: 82% of budget spent but only 61% of MTD sales plan achieved."
  // September 2026 has 30 days; uniform weights → elapsedShare = 2/3.
  const input = {
    year: 2026,
    month: 9,
    asOfDay: 20,
    salesPlanMonth: 1_000_000,
    salesActualMtd: 406_667, // 61% of the 666,667 MTD plan
    budgetMonth: 100_000,
    controlSpendMtd: 82_000,
    accruedSpendMtd: 70_000,
    actualSpendMtd: 12_000,
    weights: UNIFORM,
  };

  it("computes achievement, progress and run-rate forecast", () => {
    const r = computePacing(input);
    expect(r.elapsedShare).toBeCloseTo(0.6667, 3);
    expect(r.salesAchievementPct).toBeCloseTo(61, 0);
    expect(r.spendProgressPct).toBe(82);
    // Run-rate: 82,000 / (2/3) = 123,000 → +23% overrun.
    expect(r.forecastSpendMonth).toBeCloseTo(123_000, 0);
    expect(r.forecastBudgetVariancePct).toBeCloseTo(23, 0);
    // Sales run-rate: 406,667 / (2/3) = 610,000 → 390k shortfall.
    expect(r.forecastSalesGap).toBeCloseTo(-390_000, -1);
  });

  it("classifies the example as critical (overrun ≥ 15%)", () => {
    const r = computePacing(input);
    expect(r.riskStatus).toBe("critical");
    expect(r.dataQuality).toBe("complete");
  });

  it("persists all inputs in math for hand-audit", () => {
    const r = computePacing(input);
    expect(r.math.controlSpendMtd).toBe(82_000);
    expect(r.math.accruedSpendMtd).toBe(70_000);
    expect(r.math.elapsedWeight).toBe(20);
    expect(r.math.totalWeight).toBe(30);
  });
});

describe("computePacing — classification bands", () => {
  const base = {
    year: 2026,
    month: 9,
    asOfDay: 15, // elapsedShare = 0.5 with uniform weights
    salesPlanMonth: 1_000_000,
    salesActualMtd: 500_000, // exactly on plan
    budgetMonth: 100_000,
    accruedSpendMtd: 0,
    actualSpendMtd: 0,
    weights: UNIFORM,
  };

  it("on-pace spend → ok", () => {
    const r = computePacing({ ...base, controlSpendMtd: 50_000 });
    expect(r.riskStatus).toBe("ok");
    expect(r.forecastBudgetVariancePct).toBeCloseTo(0, 5);
  });

  it("slight overrun → watch", () => {
    const r = computePacing({ ...base, controlSpendMtd: 51_500 }); // +3% run-rate
    expect(r.riskStatus).toBe("watch");
  });

  it("moderate overrun → high", () => {
    const r = computePacing({ ...base, controlSpendMtd: 55_000 }); // +10% run-rate
    expect(r.riskStatus).toBe("high");
  });

  it("underspend → ok (savings surface via alerts, not risk status)", () => {
    const r = computePacing({ ...base, controlSpendMtd: 30_000 });
    expect(r.riskStatus).toBe("ok");
    expect(r.forecastBudgetVariance).toBeLessThan(0);
  });

  it("spend far ahead of sales triggers via pace gap even when budget is on track", () => {
    // Spend exactly on budget pace (50%), but sales badly behind (20%).
    const r = computePacing({ ...base, salesActualMtd: 200_000, controlSpendMtd: 50_000 });
    expect(r.paceGapPp).toBeCloseTo(30, 5);
    expect(r.riskStatus).toBe("critical"); // 30pp ≥ 25pp critical gap
  });

  it("thresholds are overridable", () => {
    const r = computePacing({
      ...base,
      controlSpendMtd: 55_000,
      thresholds: { ...DEFAULT_PACING_THRESHOLDS, overrunPctHigh: 50, paceGapPpHigh: 50 },
    });
    expect(r.riskStatus).toBe("watch");
  });
});

describe("computePacing — degraded data", () => {
  const base = {
    year: 2026,
    month: 9,
    asOfDay: 15,
    salesPlanMonth: 0,
    salesActualMtd: 0,
    budgetMonth: 0,
    controlSpendMtd: 0,
    accruedSpendMtd: 0,
    actualSpendMtd: 0,
    weights: UNIFORM,
  };

  it("no plan and no budget → empty + ok (no false alarms)", () => {
    const r = computePacing(base);
    expect(r.dataQuality).toBe("empty");
    expect(r.riskStatus).toBe("ok");
    expect(r.spendProgressPct).toBeNull();
    expect(r.salesAchievementPct).toBeNull();
  });

  it("budget without sales plan → partial, still paces spend", () => {
    const r = computePacing({ ...base, budgetMonth: 100_000, controlSpendMtd: 80_000 });
    expect(r.dataQuality).toBe("partial");
    expect(r.spendProgressPct).toBe(80);
    expect(r.riskStatus).toBe("critical"); // 160k run-rate on 100k budget
  });

  it("day 0 → no forecast, no crash", () => {
    const r = computePacing({ ...base, asOfDay: 0, budgetMonth: 100_000 });
    expect(r.forecastSpendMonth).toBeNull();
    expect(r.forecastBudgetVariancePct).toBeNull();
    expect(r.riskStatus).toBe("ok");
  });
});
