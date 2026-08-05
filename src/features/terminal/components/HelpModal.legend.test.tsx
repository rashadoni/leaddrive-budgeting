// @vitest-environment happy-dom
/**
 * 2026-08-05 — the cell legend described a screen that does not exist.
 *
 * It taught a grey ◇ swatch (#6B7280) for `unknown`, which no tile is ever
 * painted; it painted amber #FFA502 while the grid paints #FFB020; it had no
 * entry at all for `na` or for `missing`; and it said nothing about the corner
 * letters (d / e / m), the input-family glyphs (~ / =) or the ≠ that marks a
 * figure disagreeing with the client's own statement.
 *
 * These tests pin the rebuilt legend to `cellFaceColor` — the one function
 * that answers "what colour is this tile" — so a future edit cannot reopen the
 * gap between what the grid draws and what the legend claims.
 */

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { HelpModal } from "./HelpModal";
import { cellFaceColor, statusColor, statusShape } from "@/lib/risk/heatmap-matrix";

afterEach(() => {
  cleanup();
});

function openHelp(detail?: unknown): void {
  act(() => {
    window.dispatchEvent(
      detail === undefined
        ? new Event("terminal:open-help")
        : new CustomEvent("terminal:open-help", { detail }),
    );
  });
}

/** `#00D4AA` → `rgb(0, 212, 170)`; happy-dom may store either form. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function expectPaintedWith(el: HTMLElement, hex: string): void {
  const actual = el.style.backgroundColor.toLowerCase();
  expect([hex.toLowerCase(), hexToRgb(hex)]).toContain(actual);
}

/** Every face state a matrix tile can be painted. */
const FACE_STATES = ["green", "amber", "red", "unknown", "na", "missing"] as const;

describe("HelpModal cell legend (2026-08-05 rebuild)", () => {
  it("paints every face swatch with the colour cellFaceColor() returns", () => {
    render(<HelpModal />);
    openHelp();
    for (const state of FACE_STATES) {
      const swatch = screen.getByTestId(`legend-face-${state}`);
      expect(swatch.getAttribute("data-face")).toBe(cellFaceColor(state));
      expectPaintedWith(swatch, cellFaceColor(state));
    }
  });

  it("has a row for `na` and for `missing` — the two states it used to omit", () => {
    render(<HelpModal />);
    openHelp();
    expect(screen.getByTestId("legend-face-row-na")).toBeTruthy();
    expect(screen.getByTestId("legend-face-row-missing")).toBeTruthy();
    // And they are genuinely different faces, not one colour reused.
    expect(cellFaceColor("na")).not.toBe(cellFaceColor("unknown"));
    expect(
      screen.getByTestId("legend-face-na").getAttribute("data-face"),
    ).not.toBe(screen.getByTestId("legend-face-missing").getAttribute("data-face"));
  });

  it("never shows a colour the grid does not paint a tile", () => {
    render(<HelpModal />);
    openHelp();
    const legend = screen.getByTestId("help-legend").outerHTML.toLowerCase();
    // statusColor('unknown') is the theme ACCENT — the colour of the ◇ glyph
    // in counters and tooltips. No tile face is ever that grey; the old
    // legend used it as a swatch.
    const accentGrey = statusColor("unknown");
    expect(legend).not.toContain(accentGrey.toLowerCase());
    expect(legend).not.toContain(hexToRgb(accentGrey));
    // The old amber swatch. The grid paints #FFB020.
    expect(legend).not.toContain("#ffa502");
    expect(legend).not.toContain(hexToRgb("#FFA502"));
    // …and the amber it DOES show is the one a tile is painted.
    expectPaintedWith(screen.getByTestId("legend-face-amber"), cellFaceColor("amber"));
  });

  it("explains the unknown face in words, because a swatch of it is invisible", () => {
    render(<HelpModal />);
    openHelp();
    // The unknown face is the modal's own background colour. A rectangle of
    // it teaches nothing, so the row must carry text.
    expect(cellFaceColor("unknown")).toBe("#0A0E27");
    const note = screen.getByTestId("legend-unknown-note");
    expect(note.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    // ◇ is taught where it is actually drawn: the header counter, not a tile.
    expect(note.textContent).toContain(statusShape("unknown"));
  });

  it("gives every corner mark the grid can draw an entry", () => {
    render(<HelpModal />);
    openHelp();
    const legend = screen.getByTestId("help-legend");
    const glyphs = Array.from(legend.querySelectorAll("[data-glyph]")).map((el) =>
      el.getAttribute("data-glyph"),
    );
    // Provenance letters written by HeatMapCellTd from `cell.valueSource`.
    expect(glyphs).toContain("d");
    expect(glyphs).toContain("e");
    expect(glyphs).toContain("m");
    // Input-family glyphs written from `indicatorProvenance(ind)`.
    expect(glyphs).toContain("~");
    expect(glyphs).toContain("=");
    // The statement-mismatch alarm.
    expect(glyphs).toContain("≠");
    // "No letter" is a claim too — the number came from the client's data.
    expect(screen.getByTestId("legend-marker-computed")).toBeTruthy();
  });

  it("has an entry for each ring and for the stale-input dot", () => {
    render(<HelpModal />);
    openHelp();
    expect(screen.getByTestId("legend-ring-mismatch")).toBeTruthy();
    expect(screen.getByTestId("legend-ring-low-confidence")).toBeTruthy();
    expect(screen.getByTestId("legend-ring-drift")).toBeTruthy();
    expect(screen.getByTestId("legend-ring-stale")).toBeTruthy();
  });

  it("lands on the legend when the opener asks for it", () => {
    render(<HelpModal />);
    openHelp({ focus: "legend" });
    expect(document.activeElement).toBe(screen.getByTestId("help-legend"));
  });

  it("opens at the top when the opener says nothing — absent detail moves nothing", () => {
    render(<HelpModal />);
    openHelp();
    expect(screen.getByTestId("help-modal")).toBeTruthy();
    expect(document.activeElement).not.toBe(screen.getByTestId("help-legend"));
  });

  it("ignores a focus request it does not recognise", () => {
    render(<HelpModal />);
    openHelp({ focus: "something-else" });
    expect(document.activeElement).not.toBe(screen.getByTestId("help-legend"));
  });
});
