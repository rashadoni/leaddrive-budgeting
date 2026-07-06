import { describe, expect, it } from "vitest";

import { applyPoolPatch, planPoolUpserts } from "./budget";

const sales = new Map<number, number>([
  [1, 2_000_000],
  [2, 2_200_000],
  [3, 0],
]);

describe("planPoolUpserts", () => {
  it("creates pools for months with a sales plan at the default pct", () => {
    const plan = planPoolUpserts(sales, []);
    expect(plan).toHaveLength(2); // month 3 has no plan and no pool
    expect(plan[0]).toEqual({
      month: 1,
      salesPlanAmount: 2_000_000,
      budgetPct: 5,
      budgetAmount: 100_000,
      action: "create",
    });
  });

  it("keeps a user-set pct on re-derivation", () => {
    const plan = planPoolUpserts(sales, [
      { month: 1, budgetPct: 8, budgetAmount: 160_000, isManualAmount: false },
    ]);
    const m1 = plan.find((p) => p.month === 1)!;
    expect(m1.budgetPct).toBe(8);
    expect(m1.budgetAmount).toBe(160_000);
    expect(m1.action).toBe("update");
  });

  it("never recomputes a manual budgetAmount override", () => {
    const plan = planPoolUpserts(sales, [
      { month: 2, budgetPct: 5, budgetAmount: 77_777, isManualAmount: true },
    ]);
    const m2 = plan.find((p) => p.month === 2)!;
    expect(m2.budgetAmount).toBe(77_777);
    expect(m2.action).toBe("keep_manual");
    expect(m2.salesPlanAmount).toBe(2_200_000); // sales base still refreshes
  });

  it("keeps an existing pool alive when the sales plan drops to 0", () => {
    const plan = planPoolUpserts(new Map(), [
      { month: 5, budgetPct: 5, budgetAmount: 50_000, isManualAmount: false },
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ month: 5, salesPlanAmount: 0, budgetAmount: 0 });
  });
});

describe("applyPoolPatch", () => {
  const pool = { salesPlanAmount: 2_000_000, budgetPct: 5, budgetAmount: 100_000, isManualAmount: false };

  it("pct change recomputes the amount and clears manual flag", () => {
    expect(applyPoolPatch({ ...pool, isManualAmount: true }, { budgetPct: 7.5 })).toEqual({
      budgetPct: 7.5,
      budgetAmount: 150_000,
      isManualAmount: false,
    });
  });

  it("amount change flips to manual and keeps pct for reference", () => {
    expect(applyPoolPatch(pool, { budgetAmount: 123_456.789 })).toEqual({
      budgetPct: 5,
      budgetAmount: 123_456.79,
      isManualAmount: true,
    });
  });

  it("empty patch is a no-op", () => {
    expect(applyPoolPatch(pool, {})).toEqual({
      budgetPct: 5,
      budgetAmount: 100_000,
      isManualAmount: false,
    });
  });
});
