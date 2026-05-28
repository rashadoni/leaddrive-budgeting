"use client"

import { fmt, calcVariance } from "@/lib/budget-chart-theme"

/** Phase 8 D3(n) (2026-05-28) — single payload entry passed by Recharts'
 *  Tooltip `content` callback. Mirrors `TooltipPayload<ValueType, NameType>`
 *  from recharts/types narrowed to the fields we read. */
interface TooltipPayloadEntry {
  dataKey?: string | number
  name?: string | number
  value?: number
  color?: string
  fill?: string
}

interface TooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string
  mode?: "plan-vs-actual" | "plan-forecast-actual" | "comparison" | "composition"
  totalValue?: number
  planKey?: string
  actualKey?: string
  forecastKey?: string
}

export function BudgetChartTooltip({
  active,
  payload,
  label,
  mode = "plan-vs-actual",
  totalValue,
  planKey,
  actualKey,
  forecastKey,
}: TooltipProps) {
  if (!active || !payload?.length) return null

  return (
    <div className="bg-popover/95 backdrop-blur-sm border border-border rounded-xl p-3.5 shadow-xl text-sm min-w-[180px]">
      {label && (
        <p className="font-semibold text-popover-foreground mb-2 text-xs uppercase tracking-wide border-b border-border/50 pb-1.5">
          {label}
        </p>
      )}
      <div className="space-y-1.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: entry.color || entry.fill }}
              />
              <span className="text-muted-foreground text-xs">{entry.name}</span>
            </div>
            <span className="font-mono font-medium text-popover-foreground text-xs">
              {fmt(entry.value ?? 0)}
            </span>
          </div>
        ))}
      </div>

      {/* Variance row for plan-vs-actual */}
      {mode === "plan-vs-actual" && payload.length >= 2 && (() => {
        const planVal = planKey
          ? payload.find((p) => p.dataKey === planKey)?.value
          : payload[0]?.value
        const actVal = actualKey
          ? payload.find((p) => p.dataKey === actualKey)?.value
          : payload[1]?.value
        if (planVal == null || actVal == null) return null
        const v = calcVariance(planVal, actVal)
        const color = v.direction === "under" ? "text-emerald-500" : v.direction === "over" ? "text-red-500" : "text-amber-500"
        return (
          <div className={`mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-xs ${color}`}>
            <span>Variance</span>
            <span className="font-mono font-bold">
              {v.pct >= 0 ? "+" : ""}{v.pct.toFixed(1)}% ({v.amount >= 0 ? "+" : ""}{fmt(v.amount)})
            </span>
          </div>
        )
      })()}

      {/* Variance for plan-forecast-actual */}
      {mode === "plan-forecast-actual" && payload.length >= 2 && (() => {
        const planVal = planKey
          ? payload.find((p) => p.dataKey === planKey)?.value
          : payload[0]?.value
        const actVal = actualKey
          ? payload.find((p) => p.dataKey === actualKey)?.value
          : payload[payload.length - 1]?.value
        if (planVal == null || actVal == null) return null
        const v = calcVariance(planVal, actVal)
        const color = v.direction === "under" ? "text-emerald-500" : v.direction === "over" ? "text-red-500" : "text-amber-500"
        return (
          <div className={`mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-xs ${color}`}>
            <span>Actual vs Plan</span>
            <span className="font-mono font-bold">
              {v.pct >= 0 ? "+" : ""}{v.pct.toFixed(1)}%
            </span>
          </div>
        )
      })()}

      {/* Composition mode: show % of total */}
      {mode === "composition" && totalValue && totalValue > 0 && payload[0]?.value != null && (
        <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
          <span>Share</span>
          <span className="font-mono font-bold text-popover-foreground">
            {((payload[0].value / totalValue) * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  )
}
