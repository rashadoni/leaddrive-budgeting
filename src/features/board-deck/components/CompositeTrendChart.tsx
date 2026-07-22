/**
 * Phase 7.G Turn XLIX (Board Deck v2 Turn 3) — 12-month composite
 * trend chart.
 *
 * Simple inline SVG (no external chart library) so the print path
 * works without canvas/webgl. Renders the trailing 12 monthly
 * composite scores as a line chart with band-colored point dots and
 * the current period highlighted.
 *
 * Empty-data fallback: when ALL points are null (no monthly data yet
 * for this org) we render a calm "no trend yet" placeholder instead
 * of an empty chart. Mirrors the page's graceful-degradation design.
 *
 * Pure server component — no client interactivity. v3+ could promote
 * to client + add hover-tooltips; deferred.
 */

import { getLocale, getTranslations } from "next-intl/server";
import type { TrendPoint } from "@/features/board-deck/lib/build-trend-series";

export interface CompositeTrendChartProps {
  series: TrendPoint[];
}

const VIEWBOX_W = 600;
const VIEWBOX_H = 200;
const PAD_LEFT = 32;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;
const PLOT_W = VIEWBOX_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VIEWBOX_H - PAD_TOP - PAD_BOTTOM;

const BAND_COLOR: Record<"red" | "amber" | "green" | "unknown", string> = {
  red: "#FF4757",
  amber: "#FFB800",
  green: "#00D4AA",
  unknown: "#9CA3AF",
};

/** Convert a score (0-100) to a Y pixel inside the plot area.
 *  Score 100 sits at top of plot; 0 at bottom. */
function scoreToY(score: number): number {
  const clamped = Math.max(0, Math.min(100, score));
  return PAD_TOP + (1 - clamped / 100) * PLOT_H;
}

/** X position for an index within the series. */
function indexToX(index: number, total: number): number {
  if (total <= 1) return PAD_LEFT + PLOT_W / 2;
  return PAD_LEFT + (index / (total - 1)) * PLOT_W;
}

/** Compact month label "YYYY-MM" → "Jan" / "Feb" / ... */
function monthAbbreviation(period: string, locale: string): string {
  const m = period.match(/^\d{4}-(\d{2})$/);
  if (!m) return period;
  const idx = Number(m[1]) - 1;
  if (idx < 0 || idx > 11) return period;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2020, idx, 1)));
}

/** Build the SVG `path d` for the line. Skips null points (creates
 *  a visual gap) by starting a new sub-path with `M`. */
function buildLinePath(series: TrendPoint[]): string {
  let d = "";
  let prev: { x: number; y: number } | null = null;
  series.forEach((p, i) => {
    if (p.score === null) {
      prev = null;
      return;
    }
    const x = indexToX(i, series.length);
    const y = scoreToY(p.score);
    if (prev === null) {
      d += `M${x.toFixed(1)} ${y.toFixed(1)}`;
    } else {
      d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    prev = { x, y };
  });
  return d;
}

export async function CompositeTrendChart({
  series,
}: CompositeTrendChartProps) {
  const t = await getTranslations("terminal");
  const locale = await getLocale();

  const hasAnyData = series.some((p) => p.score !== null);
  if (!hasAnyData) {
    return (
      <section
        aria-label={t("boardDeck.metrics.trendAriaLabel")}
        data-testid="composite-trend-chart"
        className="rounded-lg bg-card border border-border p-6 print:border-black"
      >
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">
          {t("boardDeck.metrics.trendTitle")}
        </p>
        <p
          className="text-sm text-muted-foreground"
          data-testid="composite-trend-empty"
        >
          {t("boardDeck.metrics.trendEmpty")}
        </p>
      </section>
    );
  }

  const linePath = buildLinePath(series);

  // Y-axis gridlines at 0/25/50/75/100 — calm, low contrast.
  const yTicks = [0, 25, 50, 75, 100];

  // X-axis labels every 2nd month (chart spans 12 months — 6 ticks
  // is readable). Always include first + last for context.
  const xTickIndices = series
    .map((_, i) => i)
    .filter((i, _, all) => i === 0 || i === all.length - 1 || i % 2 === 0);

  return (
    <section
      aria-label={t("boardDeck.metrics.trendAriaLabel")}
      data-testid="composite-trend-chart"
      className="rounded-lg bg-card border border-border p-6 print:border-black print:break-inside-avoid"
    >
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
        {t("boardDeck.metrics.trendTitle")}
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        {t("boardDeck.metrics.trendBoundary")}
      </p>
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        className="w-full h-auto"
        role="img"
        aria-label={t("boardDeck.metrics.trendAriaLabel")}
      >
        {/* Y-axis gridlines */}
        {yTicks.map((tick) => {
          const y = scoreToY(tick);
          return (
            <g key={`y-${tick}`}>
              <line
                x1={PAD_LEFT}
                x2={VIEWBOX_W - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeDasharray={tick === 0 || tick === 100 ? "" : "2 4"}
              />
              <text
                x={PAD_LEFT - 6}
                y={y + 3}
                fontSize={9}
                fill="currentColor"
                fillOpacity={0.5}
                textAnchor="end"
                fontFamily="JetBrains Mono, monospace"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Data line */}
        <path
          data-testid="trend-line"
          d={linePath}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.8}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data points */}
        {series.map((p, i) => {
          if (p.score === null) return null;
          const x = indexToX(i, series.length);
          const y = scoreToY(p.score);
          const fill = p.band ? BAND_COLOR[p.band] : "currentColor";
          const isCurrent = i === series.length - 1;
          return (
            <g
              key={`pt-${p.period}`}
              data-testid={`trend-point-${p.period}`}
            >
              <circle
                cx={x}
                cy={y}
                r={isCurrent ? 5 : 3}
                fill={fill}
                stroke="white"
                strokeWidth={isCurrent ? 2 : 1}
              />
              {isCurrent && (
                <text
                  x={x}
                  y={y - 12}
                  fontSize={9}
                  fill={fill}
                  textAnchor="middle"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="600"
                >
                  {p.score}
                </text>
              )}
            </g>
          );
        })}

        {/* X-axis month labels */}
        {xTickIndices.map((i) => {
          const x = indexToX(i, series.length);
          const period = series[i].period;
          return (
            <text
              key={`x-${period}`}
              x={x}
              y={VIEWBOX_H - 10}
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.5}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
            >
              {monthAbbreviation(period, locale)}
            </text>
          );
        })}
      </svg>
    </section>
  );
}
