import { describe, it, expect } from "vitest";
import { varPct } from "./var-pct";

describe("varPct (sign-aware variance %)", () => {
  it("planned=0 → null (variance undefined)", () => {
    expect(varPct(100, 0)).toBeNull();
    expect(varPct(0, 0)).toBeNull();
    expect(varPct(-50, 0)).toBeNull();
  });

  it("positive plan, actual matches → 0", () => {
    expect(varPct(100, 100)).toBe(0);
  });

  it("positive plan, actual better (revenue case): plan=100, actual=120 → +20", () => {
    expect(varPct(120, 100)).toBe(20);
  });

  it("positive plan, actual worse: plan=8.13M, actual=−1.42M → ~−117%", () => {
    // Op Profit AZMADE consolidated screenshot scenario.
    expect(varPct(-1_420_000, 8_130_000)).toBeCloseTo(-117.47, 1);
  });

  it("negative plan, actual worse loss (Turn-36 EBITDA case): plan=−2M, actual=−2.7M → −35", () => {
    expect(varPct(-2_700_000, -2_000_000)).toBe(-35);
  });

  it("negative plan, actual better loss: plan=−2M, actual=−1M → +50", () => {
    expect(varPct(-1_000_000, -2_000_000)).toBe(50);
  });

  it("negative plan, actual swings to profit: plan=−2M, actual=+1M → +150", () => {
    expect(varPct(1_000_000, -2_000_000)).toBe(150);
  });

  it("positive plan, very small actual: plan=1000, actual=1 → ~−99.9", () => {
    expect(varPct(1, 1000)).toBeCloseTo(-99.9, 1);
  });
});
