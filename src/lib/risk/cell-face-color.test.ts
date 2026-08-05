/**
 * The colour a matrix tile is actually painted, in one place.
 *
 * 2026-08-04 audit. `statusColor` is the theme ACCENT — text, chips, glyphs —
 * and returns #6B7280 for `unknown`: a legible slate grey that reads as a
 * value. Tiles were never painted that. HeatMapCellTd overrode it inline
 * (#0A0E27 for unknown, #111827 for na) so an unscored cell reads as absent,
 * and that override lived in one component while every other surface — the
 * legend above all — asked `statusColor`. So the legend taught a grey swatch no
 * cell draws, and had no `na` entry at all, because the accent map has no such
 * case: `statusColor('na')` does not typecheck.
 *
 * These tests pin the two unmeasured faces to the page background specifically.
 * Anything lighter would put a visible neutral rectangle where the product's
 * whole claim is that nothing is known.
 */

import { describe, it, expect } from "vitest";
import { cellFaceColor, statusColor } from "./heatmap-matrix";

describe("cellFaceColor", () => {
  it("paints the scored states with the theme accent", () => {
    for (const state of ["green", "amber", "red"] as const) {
      expect(cellFaceColor(state)).toBe(statusColor(state));
    }
  });

  it("paints an unscored cell as the page background, not as grey", () => {
    // #0A0E27 is the terminal's panel background — the tile disappears.
    expect(cellFaceColor("unknown")).toBe("#0A0E27");
    // Guard the specific regression: the accent grey must not leak onto a tile.
    expect(cellFaceColor("unknown")).not.toBe(statusColor("unknown"));
    expect(statusColor("unknown")).toBe("#6B7280");
  });

  it("paints a not-applicable cell darker still", () => {
    // 'na' has no case in the accent map at all, which is why the legend could
    // never describe it before this function existed.
    expect(cellFaceColor("na")).toBe("#111827");
  });

  it("keeps the two unmeasured states distinguishable from each other", () => {
    expect(cellFaceColor("na")).not.toBe(cellFaceColor("unknown"));
  });

  it("paints a missing row with the accent for missing", () => {
    expect(cellFaceColor("missing")).toBe(statusColor("missing"));
  });
});
