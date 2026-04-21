"use client"

import { fmt } from "@/lib/budget-chart-theme"

interface LegendItem {
  label: string
  color: string
  total?: number
  active?: boolean
}

interface BudgetChartLegendProps {
  items: LegendItem[]
  onToggle?: (index: number) => void
  className?: string
}

export function BudgetChartLegend({ items, onToggle, className = "" }: BudgetChartLegendProps) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 pt-3 ${className}`}>
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          className={`flex items-center gap-2 text-xs transition-opacity hover:opacity-80 ${
            item.active === false ? "opacity-30" : ""
          } ${onToggle ? "cursor-pointer" : "cursor-default"}`}
          onClick={() => onToggle?.(i)}
        >
          <span
            className="w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-muted-foreground">{item.label}</span>
          {item.total != null && (
            <span className="font-mono font-medium text-foreground/80">{fmt(item.total)}</span>
          )}
        </button>
      ))}
    </div>
  )
}
