import { describe, it, expect } from "vitest";
import { isLumpyMonthly, smoothLumpyMonthly } from "./margin-smoothing";

describe("isLumpyMonthly (≥80% in one month → lumpy)", () => {
  it("100% in December → lumpy", () => {
    const monthly = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2_060_045];
    expect(isLumpyMonthly(monthly)).toBe(true);
  });

  it("100% in February (ATL P-F lump pattern) → lumpy", () => {
    const monthly = [0, -2_018_525, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(isLumpyMonthly(monthly)).toBe(true);
  });

  it("seasonal Q4 (50% Dec, 30% Nov, 20% spread) → NOT lumpy", () => {
    const monthly = [10, 10, 10, 10, 10, 10, 10, 10, 10, 30, 50, 50];
    // Dec ratio = 50/210 = 24% — well below 80%
    expect(isLumpyMonthly(monthly)).toBe(false);
  });

  it("flat distribution → NOT lumpy", () => {
    expect(isLumpyMonthly(Array(12).fill(100))).toBe(false);
  });

  it("all-zero → NOT lumpy", () => {
    expect(isLumpyMonthly(Array(12).fill(0))).toBe(false);
  });

  it("non-12-element input → NOT lumpy (defensive)", () => {
    expect(isLumpyMonthly([100, 100])).toBe(false);
    expect(isLumpyMonthly([])).toBe(false);
  });
});

describe("smoothLumpyMonthly", () => {
  it("Dec lump → spread to /12, YTD preserved", () => {
    const monthly = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1200];
    const smoothed = smoothLumpyMonthly(monthly);
    expect(smoothed).toEqual(Array(12).fill(100));
    expect(smoothed.reduce((s, v) => s + v, 0)).toBe(1200);
  });

  it("preserves seasonal pattern (NOT lumpy)", () => {
    const monthly = [10, 10, 10, 10, 10, 10, 10, 10, 10, 30, 50, 50];
    const smoothed = smoothLumpyMonthly(monthly);
    expect(smoothed).toEqual(monthly);
  });

  it("does NOT mutate input", () => {
    const monthly = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1200];
    const before = [...monthly];
    smoothLumpyMonthly(monthly);
    expect(monthly).toEqual(before);
  });

  it("preserves negative-annual lumps (FX losses)", () => {
    const monthly = [0, -2_018_525, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const smoothed = smoothLumpyMonthly(monthly);
    const expected = -2_018_525 / 12;
    expect(smoothed.every((v) => Math.abs(v - expected) < 0.01)).toBe(true);
    expect(smoothed.reduce((s, v) => s + v, 0)).toBeCloseTo(-2_018_525, 5);
  });
});
