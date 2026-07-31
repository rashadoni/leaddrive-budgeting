"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts"
import { BUDGET_COLORS, ANIMATION, AXIS_TICK, fmtK, fmt } from "@/lib/budget-chart-theme"
import type { BudgetCategoryRow } from "@/lib/budgeting/types"

interface BudgetCategoryBarsProps {
  categories: BudgetCategoryRow[]
  className?: string
}

type FilterMode = "all" | "expense" | "revenue"

export function BudgetCategoryBars({ categories, className }: BudgetCategoryBarsProps) {
  const t = useTranslations("budgeting")
  const [filter, setFilter] = useState<FilterMode>("all")
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const filtered = categories.filter(c => {
    if (filter === "expense") return c.lineType === "expense"
    if (filter === "revenue") return c.lineType === "revenue"
    return true
  })

  const data = [...filtered]
    .sort((a, b) => Math.max(b.planned, b.actual) - Math.max(a.planned, a.actual))
    .slice(0, 10)
    .map(c => {
      // Show short name: extract department part after " — ", or truncate
      const dashIdx = c.category.indexOf(" — ")
      const prefix = dashIdx > 0 ? c.category.slice(0, dashIdx) : c.category
      const dept = dashIdx > 0 ? c.category.slice(dashIdx + 3) : ""
      const shortName = dept
        ? `${prefix.length > 12 ? prefix.slice(0, 10) + "…" : prefix} — ${dept}`
        : (c.category.length > 22 ? c.category.slice(0, 20) + "…" : c.category)
      return {
        name: shortName,
        fullName: c.category,
        plan: c.planned,
        forecast: c.forecast,
        actual: c.actual,
        variancePct: c.variancePct,
        variance: c.variance,
        lineType: c.lineType,
      }
    })

  const expenseCount = categories.filter(c => c.lineType === "expense").length
  const revenueCount = categories.filter(c => c.lineType === "revenue").length

  const getActualColor = (variancePct: number) => {
    const abs = Math.abs(variancePct)
    if (abs <= 5) return BUDGET_COLORS.actualGreen
    if (abs <= 15) return BUDGET_COLORS.warning
    return BUDGET_COLORS.negative
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    if (!d) return null
    return (
      <div className="bg-popover/95 backdrop-blur-sm border border-border rounded-xl p-3 shadow-xl text-sm min-w-[220px]">
        <div className="font-semibold text-popover-foreground mb-2 pb-1.5 border-b border-border/50 flex items-center justify-between">
          <span>{d.fullName}</span>
          <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {d.lineType === "revenue" ? t("revenue") : t("expense")}
          </span>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BUDGET_COLORS.planIndigo }} />
              <span className="text-muted-foreground text-xs">{t("colPlan")}</span>
            </span>
            <span className="font-mono font-medium">{fmt(d.plan)}</span>
          </div>
          <div className="flex justify-between">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BUDGET_COLORS.warning }} />
              <span className="text-muted-foreground text-xs">{t("colForecast")}</span>
            </span>
            <span className="font-mono font-medium">{fmt(d.forecast)}</span>
          </div>
          <div className="flex justify-between">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: getActualColor(d.variancePct) }} />
              <span className="text-muted-foreground text-xs">{t("colActual")}</span>
            </span>
            <span className="font-mono font-medium">{fmt(d.actual)}</span>
          </div>
          <div className="pt-1.5 border-t border-border/50 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{t("colVariance")}</span>
              <span className="font-mono font-bold" style={{ color: getActualColor(d.variancePct) }}>
                {d.variance >= 0 ? "+" : ""}{fmt(d.variance)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{t("colVariancePct")}</span>
              <span className="font-mono font-bold" style={{ color: getActualColor(d.variancePct) }}>
                {d.variancePct >= 0 ? "+" : ""}{Math.round(d.variancePct)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const handleBarClick = (_: any, index: number) => {
    setSelectedIdx(selectedIdx === index ? null : index)
  }

  if (data.length === 0) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
          {t("categoryBarsEmpty")}
        </div>
      </div>
    )
  }

  const selected = selectedIdx !== null ? data[selectedIdx] : null

  return (
    <div className={className}>
      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-3">
        {([
          { key: "all" as FilterMode, label: `${t("filterAll")} (${categories.length})` },
          { key: "expense" as FilterMode, label: `${t("filterExpenses")} (${expenseCount})` },
          { key: "revenue" as FilterMode, label: `${t("filterRevenues")} (${revenueCount})` },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => { setFilter(tab.key); setSelectedIdx(null) }}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
              filter === tab.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 55 + 40)}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 50, top: 5, bottom: 5 }} barGap={1} barSize={12}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/15" horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} tickFormatter={v => fmtK(v)} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} width={140} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
          <Bar
            dataKey="plan"
            fill={BUDGET_COLORS.planIndigo}
            radius={[0, 3, 3, 0]}
            animationDuration={ANIMATION.duration}
            animationEasing={ANIMATION.easing}
            onClick={handleBarClick}
            className="cursor-pointer"
          >
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={BUDGET_COLORS.planIndigo}
                opacity={selectedIdx !== null && selectedIdx !== i ? 0.3 : 0.7}
              />
            ))}
          </Bar>
          <Bar
            dataKey="forecast"
            fill={BUDGET_COLORS.warning}
            radius={[0, 3, 3, 0]}
            animationDuration={ANIMATION.duration}
            animationEasing={ANIMATION.easing}
            onClick={handleBarClick}
            className="cursor-pointer"
          >
            {data.map((_, i) => (
              <Cell
                key={i}
                fill={BUDGET_COLORS.warning}
                opacity={selectedIdx !== null && selectedIdx !== i ? 0.3 : 0.85}
              />
            ))}
          </Bar>
          <Bar
            dataKey="actual"
            radius={[0, 3, 3, 0]}
            animationDuration={ANIMATION.duration}
            animationEasing={ANIMATION.easing}
            onClick={handleBarClick}
            className="cursor-pointer"
          >
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={getActualColor(entry.variancePct)}
                opacity={selectedIdx !== null && selectedIdx !== i ? 0.3 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Selected category detail card */}
      {selected && (
        <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-border animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm">{selected.fullName}</span>
            <button onClick={() => setSelectedIdx(null)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{t("colPlan")}</div>
              <div className="text-sm font-bold font-mono">{fmt(selected.plan)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{t("colActual")}</div>
              <div className="text-sm font-bold font-mono" style={{ color: getActualColor(selected.variancePct) }}>{fmt(selected.actual)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{t("colVariance")}</div>
              <div className="text-sm font-bold font-mono" style={{ color: getActualColor(selected.variancePct) }}>
                {selected.variancePct >= 0 ? "+" : ""}{Math.round(selected.variancePct)}%
              </div>
            </div>
          </div>
          {/* Mini inline bar */}
          <div className="mt-2 h-3 rounded-full bg-muted overflow-hidden relative">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, selected.plan > 0 ? (selected.actual / selected.plan) * 100 : 0)}%`,
                backgroundColor: getActualColor(selected.variancePct),
              }}
            />
            {/* Plan marker */}
            <div className="absolute inset-y-0 w-0.5 bg-foreground/40" style={{ left: "100%" }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>0</span>
            <span>{fmtK(selected.plan)} ({t("colPlan").toLowerCase()})</span>
          </div>
        </div>
      )}
    </div>
  )
}
