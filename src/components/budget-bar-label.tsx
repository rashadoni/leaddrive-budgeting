"use client"

import { fmtK } from "@/lib/budget-chart-theme"

interface BarLabelProps {
  x?: number
  y?: number
  width?: number
  height?: number
  value?: number
  index?: number
  /** If true, render for vertical layout (horizontal bars) */
  horizontal?: boolean
}

/** Smart label rendered at the end of each bar */
export function BudgetBarLabel({ x = 0, y = 0, width = 0, height = 0, value, horizontal = true }: BarLabelProps) {
  if (value == null || value === 0) return null

  const text = fmtK(value) + " ₼"

  if (horizontal) {
    // Horizontal bars: label to the right of bar
    const labelX = x + width + 6
    const labelY = y + height / 2
    return (
      <text
        x={labelX}
        y={labelY}
        fill="#94a3b8"
        fontSize={10}
        fontWeight={500}
        fontFamily="monospace"
        textAnchor="start"
        dominantBaseline="central"
      >
        {text}
      </text>
    )
  }

  // Vertical bars: label on top
  return (
    <text
      x={x + width / 2}
      y={y - 8}
      fill="#94a3b8"
      fontSize={10}
      fontWeight={500}
      fontFamily="monospace"
      textAnchor="middle"
    >
      {text}
    </text>
  )
}

/** Variance badge label for the actual bar */
export function VarianceBadgeLabel({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  value,
  planValue,
  horizontal = true,
}: BarLabelProps & { planValue?: number }) {
  if (value == null || planValue == null || planValue === 0) return null
  const pct = ((value - planValue) / planValue) * 100
  if (Math.abs(pct) < 0.5) return null

  const label = (pct >= 0 ? "+" : "") + Math.round(pct) + "%"
  const fill = pct > 5 ? "#ef4444" : pct < -5 ? "#10b981" : "#f59e0b"

  if (horizontal) {
    const labelX = x + width + 6
    const labelY = y + height / 2 + 12
    return (
      <text
        x={labelX}
        y={labelY}
        fill={fill}
        fontSize={9}
        fontWeight={700}
        fontFamily="monospace"
        textAnchor="start"
        dominantBaseline="central"
      >
        {label}
      </text>
    )
  }

  return (
    <text
      x={x + width / 2}
      y={y - 20}
      fill={fill}
      fontSize={9}
      fontWeight={700}
      fontFamily="monospace"
      textAnchor="middle"
    >
      {label}
    </text>
  )
}
