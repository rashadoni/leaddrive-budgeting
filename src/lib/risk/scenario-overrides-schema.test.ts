import { describe, it, expect } from "vitest";
import { ScenarioOverridesSchema } from "./scenario-overrides-schema";

describe("ScenarioOverridesSchema", () => {
  it("accepts the legacy adjustments[] form", () => {
    expect(
      ScenarioOverridesSchema.safeParse({ adjustments: [{ codes: ["IND_NET_MARGIN"], multiply: 0.8 }] }).success,
    ).toBe(true);
  });

  it("accepts a feed-anchored shock target (BRENT_TO_140 shape)", () => {
    const r = ScenarioOverridesSchema.safeParse({
      shock: { target: { metric: "BRENT_USD_BBL", value: 140, drives: "inputCostShock" } },
    });
    expect(r.success).toBe(true);
  });

  it("accepts a direct-lever shock (PRICE_DROP_40 shape) — the bug the user hit", () => {
    expect(ScenarioOverridesSchema.safeParse({ shock: { priceShock: -0.4 } }).success).toBe(true);
  });

  it("accepts a multi-lever shock with cost rigidity (DROUGHT_2026 shape)", () => {
    expect(
      ScenarioOverridesSchema.safeParse({ shock: { revenueShock: -0.3, yieldShock: -0.3, costRigidity: 0.8 } })
        .success,
    ).toBe(true);
  });

  it("accepts a target with assumedImportShare (AZN_DEVAL shape)", () => {
    expect(
      ScenarioOverridesSchema.safeParse({
        shock: { target: { metric: "AZN_USD", value: 2.04, drives: "fxShock" }, assumedImportShare: 0.3 },
      }).success,
    ).toBe(true);
  });

  it("rejects an empty shock (no target, no lever)", () => {
    expect(ScenarioOverridesSchema.safeParse({ shock: {} }).success).toBe(false);
  });

  it("rejects an unknown target drives value", () => {
    expect(
      ScenarioOverridesSchema.safeParse({ shock: { target: { metric: "X", value: 1, drives: "magicShock" } } })
        .success,
    ).toBe(false);
  });

  it("rejects an empty adjustments array", () => {
    expect(ScenarioOverridesSchema.safeParse({ adjustments: [] }).success).toBe(false);
  });

  it("rejects overrides with neither key", () => {
    expect(ScenarioOverridesSchema.safeParse({ foo: 1 }).success).toBe(false);
  });
});
