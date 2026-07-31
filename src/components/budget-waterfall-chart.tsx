"use client"

import { useTranslations } from "next-intl"
import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, LabelList, CartesianGrid } from "recharts"
import { BUDGET_COLORS, ANIMATION, AXIS_TICK, fmtK, fmt } from "@/lib/budget-chart-theme"

interface WaterfallChartProps {
  totalPlanned: number
  totalForecast: number
  totalActual: number
  totalVariance: number
  yearEndProjection: number
  className?: string
  onBarClick?: (barName: string) => void
}

function pctLabel(value: number, reference: number): string {
  if (reference === 0) return ""
  const pct = ((value - reference) / reference) * 100
  if (Math.abs(pct) < 0.5) return ""
  return (pct >= 0 ? "+" : "") + Math.round(pct) + "%"
}

export function BudgetWaterfallChart({
  totalPlanned,
  totalForecast,
  totalActual,
  totalVariance,
  yearEndProjection,
  className,
  onBarClick,
}: WaterfallChartProps) {
  const t = useTranslations("budgeting")
  const forecastDelta = totalForecast - totalPlanned
  const actualVsPlanPct = totalPlanned > 0 ? ((totalActual - totalPlanned) / totalPlanned * 100) : 0
  const projVsPlanPct = totalPlanned > 0 ? ((yearEndProjection - totalPlanned) / totalPlanned * 100) : 0

  // `key` is the stable identifier the color rules + onBarClick consumers
  // read; `name` is what the X axis and the tooltip render, so it carries the
  // translated label.
  const data = [
    { key: "budget", name: t("colBudget"), value: totalPlanned, base: 0, isStart: true, label: "", desc: t("wfDescPlannedBudget") },
    { key: "forecastDelta", name: t("wfBarForecastDelta"), value: Math.abs(forecastDelta), base: forecastDelta >= 0 ? totalPlanned : totalPlanned + forecastDelta, positive: forecastDelta >= 0, label: pctLabel(totalForecast, totalPlanned), desc: forecastDelta >= 0 ? t("wfDescForecastAbove") : t("wfDescForecastBelow") },
    { key: "actual", name: t("colActual"), value: totalActual, base: 0, isTotal: true, label: pctLabel(totalActual, totalPlanned), desc: t("wfDescActualExpenses") },
    { key: "varianceDelta", name: t("wfBarVarianceDelta"), value: Math.abs(totalVariance), base: totalVariance >= 0 ? totalActual : totalActual - Math.abs(totalVariance), positive: totalVariance >= 0, label: "", desc: totalVariance >= 0 ? t("wfDescVarianceOverspend") : t("wfDescVarianceSavings") },
    { key: "projection", name: t("wfBarProjection"), value: yearEndProjection, base: 0, isTotal: true, label: pctLabel(yearEndProjection, totalPlanned), desc: t("wfDescYearEndProjection") },
  ]

  const getColor = (item: (typeof data)[0]) => {
    if (item.isStart) return BUDGET_COLORS.planIndigo
    if (item.isTotal) {
      if (item.key === "actual") {
        const pct = Math.abs(actualVsPlanPct)
        if (pct <= 5) return BUDGET_COLORS.actualGreen
        if (pct <= 15) return BUDGET_COLORS.warning
        return BUDGET_COLORS.negative
      }
      if (item.key === "projection") {
        const pct = Math.abs(projVsPlanPct)
        if (pct <= 5) return BUDGET_COLORS.planViolet
        if (pct <= 15) return BUDGET_COLORS.warning
        return BUDGET_COLORS.negative
      }
      return BUDGET_COLORS.planViolet
    }
    if (item.positive === undefined) return BUDGET_COLORS.neutral
    return item.positive ? BUDGET_COLORS.positive : BUDGET_COLORS.negative
  }

  // Phase 8 D3(y) (2026-05-28) — Recharts Tooltip content props. We
  // read `payload[0].payload` (the row from the `data` array typed
  // above), so a single typed entry suffices.
  type WaterfallTooltipProps = {
    active?: boolean
    payload?: Array<{ payload: typeof data[number] }>
  }
  const CustomTooltip = ({ active, payload }: WaterfallTooltipProps) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    const color = getColor(d)
    return (
      <div className="bg-popover/95 backdrop-blur-sm border border-border rounded-xl p-3.5 shadow-xl text-sm min-w-[200px]">
        <div className="flex items-center gap-2 mb-2 border-b border-border/50 pb-2">
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
          <span className="font-semibold text-popover-foreground">{d.name}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground text-xs">{d.desc}</span>
          <span className="font-mono font-bold text-popover-foreground">{fmt(d.value)}</span>
        </div>
        {d.label && (
          <div className="mt-1.5 pt-1.5 border-t border-border/50 text-xs font-mono" style={{ color }}>
            {t("wfVsBudget", { pct: d.label })}
          </div>
        )}
      </div>
    )
  }

  // Recharts LabelList content callback props — coords come as
  // `string | number | undefined` (SVG-friendly), so we coerce to
  // pixel numbers locally before doing arithmetic.
  type LabelContentProps = {
    x?: string | number
    y?: string | number
    width?: string | number
    index?: number
  }
  const toPx = (v: string | number | undefined): number => {
    if (typeof v === "number") return v
    if (typeof v === "string") {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }
    return 0
  }
  const renderCustomLabel = (props: LabelContentProps) => {
    const x = toPx(props.x)
    const y = toPx(props.y)
    const width = toPx(props.width)
    const item = props.index != null ? data[props.index] : undefined
    if (!item) return null

    // Show value label on all bars
    const valueLabel = fmtK(item.value) + " ₼"
    const pctLabelText = item.label

    const isNegative = pctLabelText?.startsWith("-")
    const pctColor = isNegative ? BUDGET_COLORS.negative
      : pctLabelText?.startsWith("+") && parseFloat(pctLabelText) > 15 ? BUDGET_COLORS.negative
      : BUDGET_COLORS.positive

    return (
      <g>
        <text
          x={x + width / 2}
          y={y - (pctLabelText ? 18 : 8)}
          fill="#94a3b8"
          textAnchor="middle"
          fontSize={10}
          fontWeight={500}
          fontFamily="monospace"
        >
          {valueLabel}
        </text>
        {pctLabelText && (
          <text
            x={x + width / 2}
            y={y - 5}
            fill={pctColor}
            textAnchor="middle"
            fontSize={11}
            fontWeight="bold"
          >
            {pctLabelText}
          </text>
        )}
      </g>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={260} className={className}>
      <ComposedChart data={data} margin={{ left: 10, right: 10, top: 35 }}>
        <defs>
          {data.map((entry, i) => (
            <linearGradient key={i} id={`wf-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={getColor(entry)} stopOpacity={1} />
              <stop offset="100%" stopColor={getColor(entry)} stopOpacity={0.6} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/15" vertical={false} />
        <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontWeight: 500 }} axisLine={{ stroke: "#e2e8f0", strokeWidth: 1 }} tickLine={false} />
        <YAxis tick={AXIS_TICK} tickFormatter={v => fmtK(v)} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
        <ReferenceLine y={totalPlanned} stroke={BUDGET_COLORS.planIndigo} strokeDasharray="6 4" strokeWidth={1.5} opacity={0.5} />
        <Bar dataKey="base" stackId="waterfall" fill="transparent" animationDuration={0} />
        <Bar
          dataKey="value"
          stackId="waterfall"
          radius={[4, 4, 0, 0]}
          animationDuration={ANIMATION.duration}
          animationEasing={ANIMATION.easing}
          onClick={(_, index) => { if (onBarClick) onBarClick(data[index].key) }}
          style={{ cursor: onBarClick ? "pointer" : "default" }}
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={`url(#wf-grad-${i})`} />
          ))}
          <LabelList content={renderCustomLabel} />
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  )
}
