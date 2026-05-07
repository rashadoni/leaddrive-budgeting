// @vitest-environment happy-dom
/**
 * Phase 7.G Turn XLIX (Board Deck v2 Turn 3) — CompositeTrendChart tests.
 *
 * Locks: SVG render, line path generation (skips null gaps), point
 * dots colored by band, current-period highlight, empty-state
 * fallback, ariaLabel.
 */

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { TrendPoint } from "../lib/build-trend-series";
import { CompositeTrendChart } from "./CompositeTrendChart";

afterEach(() => {
  cleanup();
});

async function renderChart(series: TrendPoint[]) {
  const tree = await CompositeTrendChart({ series });
  render(tree as React.ReactElement);
}

const HEALTHY_SERIES: TrendPoint[] = [
  { period: "2025-05", score: 60, band: "amber" },
  { period: "2025-06", score: 62, band: "amber" },
  { period: "2025-07", score: 65, band: "amber" },
  { period: "2025-08", score: 68, band: "green" },
  { period: "2025-09", score: 70, band: "green" },
  { period: "2025-10", score: 72, band: "green" },
  { period: "2025-11", score: 75, band: "green" },
  { period: "2025-12", score: 73, band: "green" },
  { period: "2026-01", score: 74, band: "green" },
  { period: "2026-02", score: 76, band: "green" },
  { period: "2026-03", score: 78, band: "green" },
  { period: "2026-04", score: 80, band: "green" },
];

const SPARSE_SERIES: TrendPoint[] = [
  { period: "2025-05", score: null, band: null },
  { period: "2025-06", score: null, band: null },
  { period: "2025-07", score: null, band: null },
  { period: "2025-08", score: 50, band: "amber" },
  { period: "2025-09", score: null, band: null },
  { period: "2025-10", score: null, band: null },
  { period: "2025-11", score: 60, band: "amber" },
  { period: "2025-12", score: null, band: null },
  { period: "2026-01", score: null, band: null },
  { period: "2026-02", score: null, band: null },
  { period: "2026-03", score: null, band: null },
  { period: "2026-04", score: 70, band: "green" },
];

const ALL_NULL_SERIES: TrendPoint[] = Array.from(
  { length: 12 },
  (_, i) => ({
    period: `2026-${String(i + 1).padStart(2, "0")}`,
    score: null,
    band: null,
  }),
);

describe("CompositeTrendChart — happy path", () => {
  it("renders SVG with role=img + aria-label", async () => {
    await renderChart(HEALTHY_SERIES);
    const section = screen.getByTestId("composite-trend-chart");
    expect(section).toBeTruthy();
    const svg = section.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("12-month composite trend");
  });

  it("renders one trend point per non-null period", async () => {
    await renderChart(HEALTHY_SERIES);
    const section = screen.getByTestId("composite-trend-chart");
    HEALTHY_SERIES.forEach((p) => {
      expect(section.querySelector(`[data-testid='trend-point-${p.period}']`)).toBeTruthy();
    });
  });

  it("highlights the current (last) period with larger radius + score label", async () => {
    await renderChart(HEALTHY_SERIES);
    const last = HEALTHY_SERIES[HEALTHY_SERIES.length - 1];
    const point = screen
      .getByTestId("composite-trend-chart")
      .querySelector(`[data-testid='trend-point-${last.period}']`);
    expect(point).toBeTruthy();
    const circle = point!.querySelector("circle");
    expect(circle?.getAttribute("r")).toBe("5");
    // Score label rendered next to the highlighted point.
    expect(point!.querySelector("text")?.textContent).toBe(String(last.score));
  });

  it("colors point dots by band (green for >=67)", async () => {
    await renderChart(HEALTHY_SERIES);
    const greenPoint = screen
      .getByTestId("composite-trend-chart")
      .querySelector("[data-testid='trend-point-2026-04']");
    const circle = greenPoint!.querySelector("circle");
    expect(circle?.getAttribute("fill")).toBe("#00D4AA");
  });

  it("renders the line path (one M command per non-null run)", async () => {
    await renderChart(HEALTHY_SERIES);
    const path = screen
      .getByTestId("composite-trend-chart")
      .querySelector("[data-testid='trend-line']");
    expect(path).toBeTruthy();
    const d = path!.getAttribute("d") ?? "";
    expect(d).toMatch(/^M/);
    // 11 line segments (12 points) — each `L` after the first M.
    const lCount = (d.match(/L/g) ?? []).length;
    expect(lCount).toBe(11);
  });

  it("X-axis shows month abbreviations for sampled ticks", async () => {
    await renderChart(HEALTHY_SERIES);
    const section = screen.getByTestId("composite-trend-chart");
    expect(section.textContent).toContain("Apr"); // 2026-04 (last)
    expect(section.textContent).toContain("May"); // 2025-05 (first)
  });
});

describe("CompositeTrendChart — sparse data", () => {
  it("draws multiple sub-paths separated by null gaps", async () => {
    await renderChart(SPARSE_SERIES);
    const path = screen
      .getByTestId("composite-trend-chart")
      .querySelector("[data-testid='trend-line']");
    const d = path!.getAttribute("d") ?? "";
    // 3 non-null points → 3 `M` commands (each starts a new sub-path
    // because of the null gaps between).
    const mCount = (d.match(/M/g) ?? []).length;
    expect(mCount).toBe(3);
  });

  it("renders dots only for non-null points", async () => {
    await renderChart(SPARSE_SERIES);
    const section = screen.getByTestId("composite-trend-chart");
    expect(section.querySelector("[data-testid='trend-point-2025-08']")).toBeTruthy();
    expect(section.querySelector("[data-testid='trend-point-2025-11']")).toBeTruthy();
    expect(section.querySelector("[data-testid='trend-point-2026-04']")).toBeTruthy();
    // Null months should NOT have a point.
    expect(section.querySelector("[data-testid='trend-point-2025-05']")).toBeNull();
  });
});

describe("CompositeTrendChart — empty fallback", () => {
  it("renders 'no monthly data yet' placeholder when ALL points are null", async () => {
    await renderChart(ALL_NULL_SERIES);
    const empty = screen.getByTestId("composite-trend-empty");
    expect(empty).toBeTruthy();
    expect(empty.textContent?.toLowerCase()).toContain("no monthly data");
    // SVG NOT rendered in empty state.
    expect(screen.getByTestId("composite-trend-chart").querySelector("svg")).toBeNull();
  });
});
