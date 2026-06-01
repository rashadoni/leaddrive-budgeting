import { describe, it, expect } from "vitest";
import { computeBenchmarkBand } from "./benchmark-band";

// Real per-ha thresholds (verified against the live IndicatorDefinition table).
const REVENUE = { red: { op: "<", value: 1500 }, amber: { op: ">=", value: 1500 }, green: { op: ">=", value: 3000 } };
const COST = { red: { op: ">", value: 3500 }, amber: { op: "<=", value: 3500 }, green: { op: "<=", value: 2500 } };

describe("computeBenchmarkBand", () => {
  it("higher_better: floor = red boundary, target = green boundary", () => {
    const b = computeBenchmarkBand(REVENUE, "higher_better", 1393)!;
    expect(b.floor).toBe(1500);
    expect(b.target).toBe(3000);
    expect(b.valueStatus).toBe("red"); // 1393 < 1500
    expect(b.lowerIsBetter).toBe(false);
  });

  it("higher_better: value in amber + at/above target", () => {
    expect(computeBenchmarkBand(REVENUE, "higher_better", 2000)!.valueStatus).toBe("amber");
    expect(computeBenchmarkBand(REVENUE, "higher_better", 3200)!.valueStatus).toBe("green");
  });

  it("lower_better (cost): best = low (green), floor = high (red)", () => {
    const b = computeBenchmarkBand(COST, "lower_better", 2600)!;
    expect(b.target).toBe(2500); // best = lowest
    expect(b.floor).toBe(3500); // worst-acceptable
    expect(b.valueStatus).toBe("amber"); // 2500 < 2600 <= 3500
    expect(b.lowerIsBetter).toBe(true);
  });

  it("lower_better: at/below target green, above floor red", () => {
    expect(computeBenchmarkBand(COST, "lower_better", 2400)!.valueStatus).toBe("green");
    expect(computeBenchmarkBand(COST, "lower_better", 4000)!.valueStatus).toBe("red");
  });

  it("zones span 0→100 and are ordered by status for the direction", () => {
    const hi = computeBenchmarkBand(REVENUE, "higher_better", 2000)!;
    expect(hi.zones.map((z) => z.status)).toEqual(["red", "amber", "green"]);
    expect(hi.zones[0].fromPct).toBe(0);
    expect(hi.zones[2].toPct).toBe(100);
    const lo = computeBenchmarkBand(COST, "lower_better", 2600)!;
    expect(lo.zones.map((z) => z.status)).toEqual(["green", "amber", "red"]);
  });

  it("clamps the value marker + flags out-of-track values", () => {
    const below = computeBenchmarkBand(REVENUE, "higher_better", -100)!;
    expect(below.valuePct).toBe(0);
    expect(below.valueOutLow).toBe(true);
    const above = computeBenchmarkBand(REVENUE, "higher_better", 99999)!;
    expect(above.valuePct).toBe(100);
    expect(above.valueOutHigh).toBe(true);
  });

  it("returns null when a band can't be derived", () => {
    expect(computeBenchmarkBand(null, "higher_better", 10)).toBeNull();
    expect(computeBenchmarkBand({ green: { op: ">=", value: 5 } }, "higher_better", 10)).toBeNull(); // no red
    expect(computeBenchmarkBand(REVENUE, "band", 2000)).toBeNull(); // unsupported direction
    expect(computeBenchmarkBand({ green: { op: ">=", value: 5 }, red: { op: "<", value: 5 } }, "higher_better", 5)).toBeNull(); // equal
    expect(computeBenchmarkBand(REVENUE, "higher_better", NaN)).toBeNull();
  });
});
