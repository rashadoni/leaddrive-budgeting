import { describe, it, expect } from "vitest";
import { readActiveShock } from "./ScenarioPanel";

describe("readActiveShock — active-params chip derivation", () => {
  it("reads a feed-anchored target (the value the user edits)", () => {
    const r = readActiveShock({ shock: { target: { metric: "BRENT_USD_BBL", value: 190, drives: "inputCostShock" } } });
    expect(r?.target).toEqual({ metric: "BRENT_USD_BBL", value: 190 });
    expect(r?.levers).toEqual([]);
  });

  it("reads direct levers as percentages", () => {
    const r = readActiveShock({ shock: { priceShock: -0.4 } });
    expect(r?.levers).toEqual([{ key: "priceShock", pct: -40 }]);
    expect(r?.target).toBeNull();
  });

  it("reads multiple levers + cost rigidity", () => {
    const r = readActiveShock({ shock: { revenueShock: -0.3, yieldShock: -0.3, costRigidity: 0.8 } });
    expect(r?.levers).toEqual([
      { key: "revenueShock", pct: -30 },
      { key: "yieldShock", pct: -30 },
    ]);
    expect(r?.costRigidity).toBe(0.8);
  });

  it("returns null for legacy adjustments[] (no shock)", () => {
    expect(readActiveShock({ adjustments: [{ codes: ["X"], multiply: 0.8 }] })).toBeNull();
  });

  it("returns null for an empty / missing shock", () => {
    expect(readActiveShock({ shock: {} })).toBeNull();
    expect(readActiveShock(null)).toBeNull();
  });
});
