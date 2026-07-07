import { describe, expect, it } from "vitest";

import {
  applyPoolPatch,
  formatChannelGrain,
  parseChannelGrain,
  planChannelAllocations,
  planPoolUpserts,
} from "./budget";

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

describe("channel allocations (T9)", () => {
  const CHANNELS = new Set(["ch1", "ch2", "ch3"]);

  it("plans rows from pct of the org budget, skipping zero rows", () => {
    const { plans, errors } = planChannelAllocations(
      500_000,
      [
        { channelId: "ch1", allocationPct: 50 },
        { channelId: "ch2", allocationPct: 30 },
        { channelId: "ch3", allocationPct: 0 },
      ],
      CHANNELS
    );
    expect(errors).toEqual([]);
    expect(plans).toEqual([
      { channelId: "ch1", grainKey: "channel:ch1", allocationPct: 50, budgetAmount: 250_000 },
      { channelId: "ch2", grainKey: "channel:ch2", allocationPct: 30, budgetAmount: 150_000 },
    ]);
  });

  it("rejects duplicates, unknown channels, bad pct and >100 sums", () => {
    const dup = planChannelAllocations(100, [
      { channelId: "ch1", allocationPct: 10 },
      { channelId: "ch1", allocationPct: 10 },
    ], CHANNELS);
    expect(dup.errors.map((e) => e.code)).toContain("duplicate_channel");

    const unknown = planChannelAllocations(100, [{ channelId: "nope", allocationPct: 10 }], CHANNELS);
    expect(unknown.errors.map((e) => e.code)).toContain("unknown_channel");

    const range = planChannelAllocations(100, [{ channelId: "ch1", allocationPct: 120 }], CHANNELS);
    expect(range.errors.map((e) => e.code)).toContain("pct_out_of_range");

    const over = planChannelAllocations(100, [
      { channelId: "ch1", allocationPct: 60 },
      { channelId: "ch2", allocationPct: 45 },
    ], CHANNELS);
    expect(over.errors.map((e) => e.code)).toContain("sum_exceeds_100");
  });

  it("tolerates floating 100% sums", () => {
    const { errors } = planChannelAllocations(100, [
      { channelId: "ch1", allocationPct: 33.34 },
      { channelId: "ch2", allocationPct: 33.33 },
      { channelId: "ch3", allocationPct: 33.33 },
    ], CHANNELS);
    expect(errors).toEqual([]);
  });

  it("grain helpers round-trip", () => {
    expect(parseChannelGrain(formatChannelGrain("abc"))).toBe("abc");
    expect(parseChannelGrain("org")).toBeNull();
  });
});
