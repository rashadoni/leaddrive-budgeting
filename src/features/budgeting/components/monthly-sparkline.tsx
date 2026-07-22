"use client"

/**
 * Phase 3.1 v1.1 + v1.2 (Turn LIX closures) — compact 12-month sparkline.
 *
 * Extracted from VarianceTab.tsx (commit 5d7243f) to a shared component
 * so PLTab + future analytics surfaces can reuse the same visual.
 *
 * v1.1 = planned polyline (indigo).
 * v1.2 = optional actual polyline overlay (amber dashed) on the SAME
 * normalized axis so the user can eyeball spend-vs-plan per month.
 *
 * Normalization spans BOTH series so the two lines share a coordinate
 * frame; under-spend dips below the indigo line, over-spend rises above.
 * Empty / all-zero in BOTH series → em-dash (avoids noisy empty cells).
 *
 * `<title>` SVG child carries a per-month "Jan: plan 12K / actual 14K"
 * tooltip for keyboard / screen-reader users.
 */

interface Props {
  values?: number[]
  actuals?: number[]
  width?: number
  height?: number
  monthLabels?: string[]
  planLabel?: string
  actualLabel?: string
  distributionLabel?: string
  /** Distinguishes an evidenced all-zero actual series from absent actuals. */
  actualEvidence?: boolean
  valueFormatter?: (value: number) => string
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function fmt(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)
}

export function MonthlySparkline({
  values,
  actuals,
  width = 72,
  height = 18,
  monthLabels = MONTHS,
  planLabel = "plan",
  actualLabel = "actual",
  distributionLabel = "12-month distribution",
  actualEvidence,
  valueFormatter = fmt,
}: Props) {
  if (!values || values.length !== 12) {
    return <span className="text-muted-foreground/40 text-xs">—</span>
  }
  // Combined range across plan + actual so both polylines share an axis.
  const all = actuals && actuals.length === 12 ? [...values, ...actuals] : values
  const max = Math.max(...all)
  if (max <= 0) {
    return <span className="text-muted-foreground/40 text-xs">—</span>
  }
  const min = Math.min(...all)
  const range = max - min || 1
  const stepX = width / 11
  const toPoints = (series: number[]) =>
    series
      .map((v, i) => {
        const x = i * stepX
        const y = height - ((v - min) / range) * height
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(" ")
  const plannedPoints = toPoints(values)
  const hasActual = Boolean(
    actuals
    && actuals.length === 12
    && (actualEvidence ?? actuals.some((v) => v !== 0)),
  )
  const actualPoints = hasActual ? toPoints(actuals!) : null
  const tooltip = values
    .map((v, i) => {
      if (hasActual) {
        return `${monthLabels[i] ?? MONTHS[i]}: ${planLabel} ${valueFormatter(v)} / ${actualLabel} ${valueFormatter(actuals![i])}`
      }
      return `${monthLabels[i] ?? MONTHS[i]}: ${valueFormatter(v)}`
    })
    .join(" · ")
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={`${distributionLabel}: ${tooltip}`}
      className="overflow-visible"
      data-testid="variance-sparkline"
    >
      <title>{tooltip}</title>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={plannedPoints}
        className="text-indigo-500 dark:text-indigo-400"
        data-testid="variance-sparkline-plan"
      />
      {actualPoints && (
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeDasharray="2 1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={actualPoints}
          className="text-amber-500 dark:text-amber-400"
          data-testid="variance-sparkline-actual"
        />
      )}
    </svg>
  )
}
