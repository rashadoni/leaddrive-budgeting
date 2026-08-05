/**
 * The rule that decides whether a stored figure is a measurement.
 *
 * 2026-08-04 audit, found on production. `status: 'unknown'` rows still carry a
 * stored `value`, and for most indicators that value is 0. The HeatMap knew
 * this and printed "—". Panel 3 did not: opening a cell the matrix itself drew
 * as "No data. Low data confidence" produced a 24px headline of `0.00 index`,
 * and then ran that zero through the indicator's hint template —
 *
 *   "Customer HHI is 0.00. Above 0.25 = one buyer holds enough share to
 *    threaten cash flow on a single delayed payment."
 *
 * For a concentration measure 0.00 is the BEST attainable score, so the panel
 * told a CFO their customer concentration was perfect for a company it had no
 * figures for at all. Sixteen such cells were live when this was written.
 *
 * The direction of the error is what makes it severe: missing data reads as
 * good news, on the screen whose entire job is finding bad news early.
 */

import { describe, it, expect } from "vitest";
import { hasEvidencedValue } from "./heatmap-matrix";

describe("hasEvidencedValue", () => {
  it("rejects the stored zero behind an unknown status", () => {
    // The exact production shape: AZSEKER-EDEN / CUSTOMER_HHI.
    expect(hasEvidencedValue("unknown", 0)).toBe(false);
  });

  it("accepts an evidenced zero", () => {
    // A measured 0 is a real answer and must keep showing as 0 — this is the
    // whole reason the rule keys on status rather than on the number.
    expect(hasEvidencedValue("green", 0)).toBe(true);
    expect(hasEvidencedValue("red", 0)).toBe(true);
  });

  it("rejects not-applicable and missing pairs", () => {
    expect(hasEvidencedValue("na", 0)).toBe(false);
    expect(hasEvidencedValue("missing", 12.5)).toBe(false);
  });

  it("rejects an absent status", () => {
    expect(hasEvidencedValue(null, 42)).toBe(false);
    expect(hasEvidencedValue(undefined, 42)).toBe(false);
  });

  it("rejects a scored status with no usable number", () => {
    expect(hasEvidencedValue("green", null)).toBe(false);
    expect(hasEvidencedValue("green", undefined)).toBe(false);
    expect(hasEvidencedValue("green", Number.NaN)).toBe(false);
    expect(hasEvidencedValue("green", Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("accepts ordinary scored figures", () => {
    expect(hasEvidencedValue("green", 27.99)).toBe(true);
    expect(hasEvidencedValue("amber", -0.2)).toBe(true);
    expect(hasEvidencedValue("red", 246.6)).toBe(true);
  });
});
