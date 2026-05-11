"use client";

/**
 * Phase B3 (Bloomberg uplift plan) — inline SVG sparkline.
 *
 * Renders a compact 12-slot trailing-month series as an SVG path. Used
 * by HeatMap cell tooltips + IndicatorDetail panel. Color is bound to
 * the indicator's status (green/amber/red/unknown), matching Bloomberg's
 * status-tinted price-trend lines.
 *
 * Null slots are rendered as gaps (Bloomberg "no-tick" semantic) — the
 * path breaks where data is missing rather than interpolating across
 * unknown periods. This makes evaluation failures honestly visible.
 *
 * No dependency on a chart library — direct SVG path construction.
 * Bundle-size win + zero runtime overhead vs Recharts/Visx for this
 * size class (12 points). Compact-mode-aware via the `compact` prop:
 * 80×24 default → 56×16 in compact.
 */

import React from "react";

export type SparklineStatus = "green" | "amber" | "red" | "unknown" | "missing";

interface Props {
  /** 12-slot series, oldest first. `null` = evaluation gap (rendered as line break). */
  data: (number | null)[];
  /** Status drives stroke color. Defaults to neutral gray. */
  status?: SparklineStatus;
  /** Compact-mode toggle — halves dimensions. */
  compact?: boolean;
  /**
   * Responsive sizing toggle — when true, the SVG renders with
   * `width="100%" height="100%"` + `viewBox` + `preserveAspectRatio`,
   * letting it grow to fill its parent (e.g. a `flex-1` card slot).
   * Closes sub-36 architect 💡 (CARRYOVER L133): SnapshotCard's fixed
   * 80×24 sparkline was dwarfed inside stretched flex cards; opt-in via
   * this prop keeps HeatMap-cell + IndicatorDetail call-sites byte-for-byte
   * compatible (they rely on cell-fit fixed dims).
   */
  responsive?: boolean;
  /** CLI Bloomberg-sweep — custom width/height for inline-in-cell rendering.
   *  Overrides `compact` dimensions when both are set. Used by HeatMap cells
   *  to fit a 28×10 mini-spark next to the inline numeric value. */
  width?: number;
  height?: number;
  /** Optional accessible description for screen readers. */
  ariaLabel?: string;
}

/**
 * Build the SVG dimension props. In responsive mode we drop concrete
 * width/height attributes (parent flex-box drives the size) and emit
 * a `viewBox` + `preserveAspectRatio` so the path coordinates (which
 * are still computed in the original `width × height` space below)
 * scale uniformly without distortion.
 */
function svgSizingProps(width: number, height: number, responsive: boolean) {
  if (responsive) {
    return {
      width: '100%' as const,
      height: '100%' as const,
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: 'xMinYMin meet' as const,
    };
  }
  return { width, height };
}

const COLORS: Record<SparklineStatus, string> = {
  green: "#00D4AA",
  amber: "#FFA502",
  red: "#FF4757",
  unknown: "#6B7280",
  missing: "#374151",
};

const NORMAL_WIDTH = 80;
const NORMAL_HEIGHT = 24;
// Match HeatMap compact cell dims (40×12 per `HeatMap.tsx:399`) so a future
// inline-column form-factor doesn't overflow the cell.
const COMPACT_WIDTH = 40;
const COMPACT_HEIGHT = 12;
// Below this absolute range, treat the series as flat and render a single
// centerline path. Avoids FP-rounding noise on identical-value series like
// the post-B2 rollup-sourced indicators (range ≈ 1e-15 from inexact mul).
const FLAT_EPSILON = 1e-9;

export function Sparkline({
  data,
  status = "unknown",
  compact = false,
  responsive = false,
  width: widthOverride,
  height: heightOverride,
  ariaLabel,
}: Props) {
  const width = widthOverride ?? (compact ? COMPACT_WIDTH : NORMAL_WIDTH);
  const height = heightOverride ?? (compact ? COMPACT_HEIGHT : NORMAL_HEIGHT);
  const color = COLORS[status];
  const sizing = svgSizingProps(width, height, responsive);

  // No data or all-null → render an empty axis baseline so the column
  // width stays stable; renders at status-tinted opacity 0.2 to indicate
  // "data slot reserved, no value".
  const numericPoints = data
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => typeof p.v === "number");

  if (numericPoints.length === 0) {
    return (
      <svg
        {...sizing}
        role="img"
        aria-label={ariaLabel ?? "Sparkline (no data)"}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeOpacity={0.2}
          strokeWidth={1}
        />
      </svg>
    );
  }

  // Y-axis range: tight to data ± 5% padding so visible variation isn't
  // squashed by an artificial 0-baseline (sparklines show TREND, not
  // absolute scale — that's what the cell value is for).
  const values = numericPoints.map((p) => p.v);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const rawRange = maxV - minV;

  // Snap-to-centerline for effectively-flat series — without this, a row
  // of identical values (e.g. flat-rollup sparklines pre-resolver-fix)
  // would render as a busy line at random Y due to FP normalisation in
  // `(v - yMin) / (yMax - yMin)` when range is sub-epsilon.
  if (rawRange < FLAT_EPSILON) {
    return (
      <svg
        {...sizing}
        role="img"
        aria-label={
          ariaLabel ?? `Sparkline (flat at ${minV.toFixed(2)})`
        }
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeOpacity={0.85}
          strokeWidth={1.25}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const pad = rawRange * 0.05;
  const yMin = minV - pad;
  const yMax = maxV + pad;

  // Map each (i, v) → (x, y) in SVG space. Null slots break the path by
  // emitting a fresh `M` segment (Bloomberg "no-tick" gap).
  const xStep = data.length > 1 ? width / (data.length - 1) : 0;
  let path = "";
  let inSegment = false;
  data.forEach((v, i) => {
    if (typeof v !== "number") {
      inSegment = false;
      return;
    }
    const x = i * xStep;
    const y = height - ((v - yMin) / (yMax - yMin)) * height;
    path += `${inSegment ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    inSegment = true;
  });

  return (
    <svg
      {...sizing}
      role="img"
      aria-label={
        ariaLabel ??
        `Sparkline: ${numericPoints.length} of ${data.length} points, range ${minV.toFixed(2)}–${maxV.toFixed(2)}`
      }
    >
      <path
        d={path.trim()}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
