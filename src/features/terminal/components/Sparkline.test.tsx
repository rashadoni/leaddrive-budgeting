// @vitest-environment happy-dom
/**
 * Phase B3 — Sparkline SVG component tests.
 *
 * Locks in:
 *   - empty array OR all-null → baseline-only stub (no path)
 *   - single point → renders a degenerate point (length-1 path)
 *   - typical series → SVG path with N segments
 *   - null slot mid-series → path breaks (separate `M` for the resume)
 *   - status drives stroke color
 *   - compact prop halves dimensions
 *   - accessible label fallback
 */

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

afterEach(() => cleanup());

describe("Sparkline (Phase B3)", () => {
  it("empty data renders baseline stub (no path element)", () => {
    const { container } = render(<Sparkline data={[]} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(container.querySelector("path")).toBeNull();
    expect(container.querySelector("line")).toBeTruthy();
  });

  it("all-null data renders baseline stub", () => {
    const { container } = render(<Sparkline data={[null, null, null, null]} />);
    expect(container.querySelector("path")).toBeNull();
    expect(container.querySelector("line")).toBeTruthy();
  });

  it("single numeric point renders centerline (range=0 hits snap-to-flat branch)", () => {
    const { container } = render(<Sparkline data={[42]} />);
    // Single point: rawRange = 0 < FLAT_EPSILON → snap-to-flat
    expect(container.querySelector("path")).toBeNull();
    const line = container.querySelector("line")!;
    expect(line).toBeTruthy();
    expect(line.getAttribute("stroke-opacity")).toBe("0.85");
  });

  it("typical 12-point series renders a full path with 11 line segments", () => {
    const series = Array.from({ length: 12 }, (_, i) => i * 10);
    const { container } = render(<Sparkline data={series} />);
    const d = container.querySelector("path")!.getAttribute("d") ?? "";
    // 1 M + 11 L
    expect((d.match(/M/g) ?? []).length).toBe(1);
    expect((d.match(/L/g) ?? []).length).toBe(11);
  });

  it("null slot mid-series breaks the path (extra M after the gap)", () => {
    // 0,1,2,null,4,5 → path is M(0)L(1)L(2)  M(4)L(5)
    const { container } = render(<Sparkline data={[0, 1, 2, null, 4, 5]} />);
    const d = container.querySelector("path")!.getAttribute("d") ?? "";
    expect((d.match(/M/g) ?? []).length).toBe(2); // two segments
    expect((d.match(/L/g) ?? []).length).toBe(3); // 2 in first seg + 1 in second
  });

  it("status drives stroke color (red = #FF4757)", () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} status="red" />,
    );
    expect(container.querySelector("path")!.getAttribute("stroke")).toBe(
      "#FF4757",
    );
  });

  it("status='amber' uses amber color #FFA502", () => {
    const { container } = render(
      <Sparkline data={[1, 2]} status="amber" />,
    );
    expect(container.querySelector("path")!.getAttribute("stroke")).toBe(
      "#FFA502",
    );
  });

  it("status='green' uses brand teal #00D4AA", () => {
    const { container } = render(
      <Sparkline data={[1, 2]} status="green" />,
    );
    expect(container.querySelector("path")!.getAttribute("stroke")).toBe(
      "#00D4AA",
    );
  });

  it("compact prop matches HeatMap compact cell dims (40×12)", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} compact />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("40");
    expect(svg.getAttribute("height")).toBe("12");
  });

  it("default dimensions are 80×24", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("80");
    expect(svg.getAttribute("height")).toBe("24");
  });

  it("ariaLabel prop overrides default screen-reader description", () => {
    render(<Sparkline data={[1, 2]} ariaLabel="Net margin trend" />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Net margin trend",
    );
  });

  it("default aria-label falls back to the localized series description", () => {
    render(<Sparkline data={[10, 20, null, 30]} />);
    // The default label is now `terminal.sparkline.ariaSeries` resolved via
    // next-intl (the vitest mock renders unmapped keys as the uppercased
    // leaf). Assert the fallback is present and non-empty — the point
    // count / range live in the catalogue string's ICU placeholders.
    const label = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(label.length).toBeGreaterThan(0);
    expect(label).toMatch(/aria ?series/i);
  });

  it("flat series (all-same value) renders centerline (snap-to-flat branch)", () => {
    const { container } = render(<Sparkline data={[5, 5, 5, 5]} />);
    // Snap-to-flat: no <path>, only a <line> centered at height/2
    expect(container.querySelector("path")).toBeNull();
    const line = container.querySelector("line")!;
    expect(line.getAttribute("y1")).toBe("12"); // 24 / 2
    expect(line.getAttribute("y2")).toBe("12");
    // Status-tinted at 0.85 opacity (not the 0.2 baseline-stub opacity)
    expect(line.getAttribute("stroke-opacity")).toBe("0.85");
  });

  it("near-flat series (range < 1e-9) also snaps to centerline (FP guard)", () => {
    const { container } = render(<Sparkline data={[5, 5 + 1e-12, 5 - 1e-12]} />);
    // Snap-to-flat triggered → no path element
    expect(container.querySelector("path")).toBeNull();
    expect(container.querySelector("line")).toBeTruthy();
  });
});

describe("Sparkline — responsive prop (sub-36 architect 💡 / CARRYOVER L133 closure)", () => {
  it("responsive=false (default) keeps fixed pixel dims (back-compat lock)", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("80");
    expect(svg.getAttribute("height")).toBe("24");
    expect(svg.getAttribute("viewBox")).toBeNull();
    expect(svg.getAttribute("preserveAspectRatio")).toBeNull();
  });

  it("responsive=true emits width=100% + height=100% + viewBox + preserveAspectRatio (default size)", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} responsive />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("100%");
    expect(svg.getAttribute("height")).toBe("100%");
    expect(svg.getAttribute("viewBox")).toBe("0 0 80 24");
    // happy-dom serializes camelCase SVG attrs in lowercase form
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMinYMin meet");
  });

  it("responsive=true with compact=true uses 40×12 viewBox (compact dims preserved)", () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} compact responsive />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("100%");
    expect(svg.getAttribute("height")).toBe("100%");
    expect(svg.getAttribute("viewBox")).toBe("0 0 40 12");
  });

  it("responsive=true on empty-data branch (no path) still emits viewBox sizing", () => {
    const { container } = render(<Sparkline data={[]} responsive />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("100%");
    expect(svg.getAttribute("height")).toBe("100%");
    expect(svg.getAttribute("viewBox")).toBe("0 0 80 24");
    // Baseline-stub <line> coords still in the original 80×24 space
    const line = container.querySelector("line")!;
    expect(line.getAttribute("x2")).toBe("80");
    expect(line.getAttribute("y1")).toBe("12");
  });

  it("responsive=true on flat-line branch keeps centerline coords in original viewBox space", () => {
    const { container } = render(
      <Sparkline data={[5, 5, 5, 5]} responsive />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 80 24");
    const line = container.querySelector("line")!;
    // Centerline at 24/2 = 12 in viewBox space (NOT in pixel space)
    expect(line.getAttribute("y1")).toBe("12");
    expect(line.getAttribute("y2")).toBe("12");
    expect(line.getAttribute("stroke-opacity")).toBe("0.85");
  });

  it("responsive path coords match non-responsive (only sizing differs)", () => {
    const series = [10, 20, 30];
    const fixed = render(<Sparkline data={series} />);
    const flexible = render(<Sparkline data={series} responsive />);
    const dFixed = fixed.container.querySelector("path")!.getAttribute("d");
    const dFlexible = flexible.container.querySelector("path")!.getAttribute("d");
    // Path coordinates are byte-identical — viewBox handles the scaling.
    expect(dFlexible).toBe(dFixed);
  });
});
