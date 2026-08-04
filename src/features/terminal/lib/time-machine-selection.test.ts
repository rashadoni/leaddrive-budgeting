/**
 * 2026-08-04 audit, measured on production before the fix:
 *
 *   chips pressed : ["Q1"]
 *   header        : "HEATMAP · 2025-Q1"
 *   time machine  : "All of 2025"     ← the loudest control, and the wrong one
 *
 * `detectMonth` matched only /^\d{4}-(\d{2})$/, so a quarter fell through to
 * the annual branch. A label that contradicts the data under it is worse than
 * no label, because the reader cannot tell which of the two is stale.
 */

import { describe, it, expect } from "vitest";
import {
  parseTimeMachineSelection,
  sliderPositionFor,
} from "./time-machine-selection";

describe("parseTimeMachineSelection", () => {
  it("reads a quarter as a quarter", () => {
    expect(parseTimeMachineSelection("2025-Q1", 2026)).toEqual({
      kind: "quarter",
      year: 2025,
      quarter: 1,
    });
    expect(parseTimeMachineSelection("2026-Q4", 2026)).toEqual({
      kind: "quarter",
      year: 2026,
      quarter: 4,
    });
  });

  it("still reads a month as a month", () => {
    expect(parseTimeMachineSelection("2025-03", 2026)).toEqual({
      kind: "month",
      year: 2025,
      month: 3,
    });
    expect(parseTimeMachineSelection("2025-12", 2026)).toEqual({
      kind: "month",
      year: 2025,
      month: 12,
    });
  });

  it("still reads a bare year as annual", () => {
    expect(parseTimeMachineSelection("2025", 2026)).toEqual({
      kind: "annual",
      year: 2025,
    });
  });

  it("rejects an out-of-range month rather than trusting the digits", () => {
    expect(parseTimeMachineSelection("2025-13", 2026).kind).toBe("annual");
    expect(parseTimeMachineSelection("2025-00", 2026).kind).toBe("annual");
  });

  it("falls back to the given year when the period carries none", () => {
    expect(parseTimeMachineSelection("", 2026)).toEqual({ kind: "annual", year: 2026 });
    expect(parseTimeMachineSelection("garbage", 2026)).toEqual({ kind: "annual", year: 2026 });
  });
});

describe("sliderPositionFor", () => {
  it("puts a month at its own position", () => {
    expect(sliderPositionFor({ kind: "month", year: 2025, month: 7 })).toBe(7);
  });

  it("leaves a quarter at the no-specific-month slot", () => {
    // A quarter spans three months and has no single honest knob position. The
    // label names it instead — that was the part that lied.
    expect(sliderPositionFor({ kind: "quarter", year: 2025, quarter: 1 })).toBe(0);
  });

  it("leaves the annual view at zero", () => {
    expect(sliderPositionFor({ kind: "annual", year: 2025 })).toBe(0);
  });
});
