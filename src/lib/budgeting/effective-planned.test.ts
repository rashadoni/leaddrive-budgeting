import { describe, it, expect } from "vitest";
import { getEffectivePlanned } from "./effective-planned";

describe("getEffectivePlanned (Turn 29 Bug #1b defensive fallback)", () => {
  it("isAutoPlanned=false → returns stored plannedAmount directly", () => {
    const line = { isAutoPlanned: false, plannedAmount: 100_000 };
    const computeFn = () => 999_999; // ignored
    expect(getEffectivePlanned(line, computeFn)).toBe(100_000);
  });

  it("isAutoPlanned=true + computed > 0 → returns computed", () => {
    const line = { isAutoPlanned: true, plannedAmount: 100_000 };
    const computeFn = () => 50_000;
    expect(getEffectivePlanned(line, computeFn)).toBe(50_000);
  });

  it("isAutoPlanned=true + computed === 0 + plannedAmount > 0 → fallback to stored", () => {
    // The AZMADE original-sin case: line marked auto-planned but no upstream
    // data → compute returns 0, but stored plannedAmount has a real value.
    const line = { isAutoPlanned: true, plannedAmount: 100_000 };
    const computeFn = () => 0;
    expect(getEffectivePlanned(line, computeFn)).toBe(100_000);
  });

  it("isAutoPlanned=true + computed === 0 + plannedAmount === 0 → returns 0 (no fallback)", () => {
    // Genuine zero: both compute and stored are 0. No fallback fires —
    // returns the computed value (0). Prevents the fallback from masking
    // legitimate empty rows.
    const line = { isAutoPlanned: true, plannedAmount: 0 };
    const computeFn = () => 0;
    expect(getEffectivePlanned(line, computeFn)).toBe(0);
  });

  it("isAutoPlanned=true + computed > 0 + plannedAmount > 0 → computed wins (NOT fallback)", () => {
    // Both have values — auto-planned wins. Fallback is opt-in only when
    // compute returns 0 (i.e. upstream data missing).
    const line = { isAutoPlanned: true, plannedAmount: 100_000 };
    const computeFn = () => 75_000;
    expect(getEffectivePlanned(line, computeFn)).toBe(75_000);
  });

  it("isAutoPlanned=true + computed negative → returns negative (no fallback)", () => {
    // Negative computed values are valid (e.g. revenue contras). Fallback
    // ONLY fires for `=== 0` to avoid masking legitimate negatives.
    const line = { isAutoPlanned: true, plannedAmount: 100_000 };
    const computeFn = () => -5000;
    expect(getEffectivePlanned(line, computeFn)).toBe(-5000);
  });

  it("isAutoPlanned=false + plannedAmount === 0 → returns 0 (no compute call)", () => {
    let computeCalled = false;
    const line = { isAutoPlanned: false, plannedAmount: 0 };
    const computeFn = () => {
      computeCalled = true;
      return 999;
    };
    expect(getEffectivePlanned(line, computeFn)).toBe(0);
    expect(computeCalled).toBe(false); // verify short-circuit
  });
});
