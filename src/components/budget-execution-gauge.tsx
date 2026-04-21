"use client"

import { BUDGET_COLORS } from "@/lib/budget-chart-theme"

interface BudgetExecutionGaugeProps {
  executionPct: number
  expenseExecPct: number
  revenueExecPct: number
  elapsedPct: number
  className?: string
}

function getColor(pct: number) {
  // >= 80% — green, 50-80% — yellow, < 50% — red
  if (pct >= 80) return BUDGET_COLORS.positive
  if (pct >= 50) return BUDGET_COLORS.warning
  return BUDGET_COLORS.negative
}

function MiniProgress({ label, value, color }: { label: string; value: number; color: string }) {
  const capped = Math.min(value, 100)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium" style={{ color }}>{Math.round(value)}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${capped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

export function BudgetExecutionGauge({
  executionPct,
  expenseExecPct,
  revenueExecPct,
  elapsedPct,
  className,
}: BudgetExecutionGaugeProps) {
  const mainColor = getColor(executionPct)
  const expColor = getColor(expenseExecPct)
  const revColor = getColor(revenueExecPct)

  const size = 160
  const r = 62
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  const pct = Math.min(executionPct / 100, 1.5)
  const dashOffset = circumference * (1 - pct)

  // Elapsed marker
  const elapsedAngle = (Math.min(elapsedPct, 100) / 100) * 360
  const elapsedRad = ((elapsedAngle - 90) * Math.PI) / 180
  const markerX = cx + (r + 8) * Math.cos(elapsedRad)
  const markerY = cy + (r + 8) * Math.sin(elapsedRad)

  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-3">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <defs>
            <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={mainColor} stopOpacity={1} />
              <stop offset="100%" stopColor={mainColor} stopOpacity={0.6} />
            </linearGradient>
          </defs>
          {/* Background track */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth={10} className="text-muted" />
          {/* Progress arc */}
          <circle
            cx={cx} cy={cy} r={r} fill="none"
            stroke="url(#gauge-grad)" strokeWidth={10}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
          />
          {/* Elapsed time marker */}
          {elapsedPct > 0 && elapsedPct < 100 && (
            <circle cx={markerX} cy={markerY} r={3} fill="#94a3b8" opacity={0.7} />
          )}
          {/* Center text */}
          <text
            x={cx} y={cy - 4}
            textAnchor="middle" dominantBaseline="middle"
            style={{ transform: "rotate(90deg)", transformOrigin: `${cx}px ${cy}px`, fontSize: "28px", fontWeight: 800, fill: mainColor }}
          >
            {Math.round(executionPct)}%
          </text>
          <text
            x={cx} y={cy + 18}
            textAnchor="middle" dominantBaseline="middle"
            style={{ transform: "rotate(90deg)", transformOrigin: `${cx}px ${cy}px`, fontSize: "10px", fontWeight: 500, fill: "#94a3b8" }}
          >
            target: {Math.round(elapsedPct)}%
          </text>
        </svg>

        <div className="w-full max-w-[200px] space-y-2">
          <MiniProgress label="Expenses" value={expenseExecPct} color={expColor} />
          <MiniProgress label="Revenue" value={revenueExecPct} color={revColor} />
        </div>
      </div>
    </div>
  )
}
