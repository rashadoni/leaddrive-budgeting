import { describe, it, expect } from "vitest";
import { execPct } from "./exec-pct";

describe("execPct (Turn 38 sign-aware execution % helper)", () => {
  it("planned === 0 → 0 (no plan to compare against)", () => {
    expect(execPct(50_000, 0)).toBe(0);
    expect(execPct(0, 0)).toBe(0);
    expect(execPct(-500, 0)).toBe(0);
  });

  it("planned > 0 normal: actual=80% of plan → 80", () => {
    expect(execPct(80_000, 100_000)).toBe(80);
  });

  it("planned > 0 over-shoot: actual=350% of plan → clamps to 200", () => {
    expect(execPct(350_000, 100_000)).toBe(200);
  });

  it("planned < 0 worse (Turn-36 audit case): plan=-2M, actual=-2.7M → 65 (smaller than 100, bigger loss)", () => {
    // Pre-Turn-38 this case showed 135% via Math.abs ratio (looked like
    // "over-achieved"). New branch correctly reads it as under-performance.
    expect(execPct(-2_700_000, -2_000_000)).toBe(65);
  });

  it("planned < 0 better: plan=-2M, actual=-1M → 150 (bigger than 100, smaller loss)", () => {
    expect(execPct(-1_000_000, -2_000_000)).toBe(150);
  });

  it("planned < 0 over-shoot: plan=-2M, actual=+1M → clamps to 200 (loss flipped to profit)", () => {
    expect(execPct(1_000_000, -2_000_000)).toBe(200);
  });
});
