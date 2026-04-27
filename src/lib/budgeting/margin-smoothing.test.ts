import { describe, it, expect } from "vitest";
import { isLumpyMonthly, smoothLumpyMonthly, sumPerRowSmoothed } from "./margin-smoothing";

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

describe("sumPerRowSmoothed (per-row smoothing prevents agg wash-out)", () => {
  it("mixed lumpy + seasonal rows: lumpy is smoothed BEFORE summing, seasonal preserved", () => {
    // Row 1: 100% in Dec (single-month lump) — should be smoothed to /12.
    const lumpy = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1200];
    // Row 2: even monthly with mild summer dip — NOT lumpy, untouched.
    const seasonal = [100, 100, 100, 100, 80, 80, 80, 100, 100, 100, 100, 100];
    const summed = sumPerRowSmoothed([lumpy, seasonal], true);
    // Expected: row1 smoothed → 100 each; row2 untouched.
    // Dec: lumpy_smoothed[11]=100 + seasonal[11]=100 = 200.
    expect(summed[11]).toBe(200);
    // Jan: lumpy_smoothed[0]=100 + seasonal[0]=100 = 200.
    expect(summed[0]).toBe(200);
    // YTD sum preserved: lumpy 1200 + seasonal sum = 1200 + 1140 = 2340.
    const total = summed.reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(2340, 5);
  });

  it("smoothing OFF: returns raw aggregate (Bookkeeping mode)", () => {
    const lumpy = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1200];
    const seasonal = [100, 100, 100, 100, 80, 80, 80, 100, 100, 100, 100, 100];
    const summed = sumPerRowSmoothed([lumpy, seasonal], false);
    expect(summed[11]).toBe(1300); // Dec = lumpy(1200) + seasonal(100), no smoothing
    expect(summed[0]).toBe(100); // Jan = 0 + 100
  });

  it("empty rows array → all-zero 12 elements", () => {
    expect(sumPerRowSmoothed([], true)).toEqual(Array(12).fill(0));
  });
});
