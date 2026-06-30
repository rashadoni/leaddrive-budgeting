"use client"

import { useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Activity, BarChart3 } from "lucide-react"
import { BUDGET_COLORS, fmtK } from "@/lib/budget-chart-theme"
import { cn } from "@/lib/utils"
import type {
  EbitdaBridgeStep,
  PnlPerformanceMetric,
  PnlPerformancePoint,
} from "@/lib/budgeting/pnl-performance"

const METRICS: Array<{ key: PnlPerformanceMetric; label: string; favorable: "up" | "down" }> = [
  { key: "revenue", label: "Revenue", favorable: "up" },
  { key: "cogs", label: "COGS", favorable: "down" },
  { key: "opex", label: "OPEX", favorable: "down" },
  { key: "ebitda", label: "EBITDA", favorable: "up" },
  { key: "netProfit", label: "Net Profit", favorable: "up" },
]

interface PnlPerformanceChartsProps {
  monthly: Record<PnlPerformanceMetric, PnlPerformancePoint[]>
  bridge: EbitdaBridgeStep[]
  hasActuals: boolean
}

export function PnlPerformanceCharts({
  monthly,
  bridge,
  hasActuals,
}: PnlPerformanceChartsProps) {
  const [metric, setMetric] = useState<PnlPerformanceMetric>("ebitda")
  const activeMetric = METRICS.find((item) => item.key === metric) ?? METRICS[3]
  const selectedData = monthly[metric]
  const annual = useMemo(
    () => selectedData.reduce(
      (acc, row) => ({
        budget: acc.budget + row.budget,
        actual: acc.actual + row.actual,
      }),
      { budget: 0, actual: 0 },
    ),
    [selectedData],
  )
  const annualVariance = annual.actual - annual.budget
  const annualExecution = annual.budget === 0 ? null : (annual.actual / annual.budget) * 100
  const varianceIsFavorable = activeMetric.favorable === "up"
    ? annualVariance >= 0
    : annualVariance <= 0

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
      <section className="xl:col-span-3 rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Actual vs Budget P&L</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Monthly comparison for Revenue, COGS, OPEX, EBITDA and Net Profit.
            </p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted/60 p-1" role="tablist" aria-label="P&L metric">
            {METRICS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={metric === item.key}
                onClick={() => setMetric(item.key)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                  metric === item.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <MetricSummary label="Budget" value={annual.budget} />
          <MetricSummary label="Actual" value={annual.actual} muted={!hasActuals} />
          <MetricSummary
            label="Variance"
            value={annualVariance}
            tone={varianceIsFavorable ? "positive" : "negative"}
            suffix={annualExecution == null ? "" : ` · ${annualExecution.toFixed(0)}%`}
            signed
          />
        </div>

        <div className="mt-4 h-[300px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart data={selectedData} margin={{ top: 8, right: 18, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmtK} />
              <Tooltip content={<MonthlyTooltip metric={activeMetric.label} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="budget" name="Budget" fill={BUDGET_COLORS.planIndigo} radius={[4, 4, 0, 0]} />
              <Bar dataKey="actual" name="Actual" fill={BUDGET_COLORS.actualGreen} radius={[4, 4, 0, 0]} opacity={hasActuals ? 1 : 0.35} />
              <Line
                type="monotone"
                dataKey="variance"
                name="Variance"
                stroke={BUDGET_COLORS.forecastAmber}
                strokeWidth={2}
                dot={{ r: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="xl:col-span-2 rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">EBITDA variance bridge</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Starts with Budget EBITDA and shows which P&L lines moved it to Actual EBITDA.
            </p>
          </div>
          {!hasActuals && (
            <span className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              No actuals
            </span>
          )}
        </div>

        <div className="mt-4 h-[340px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={bridge} layout="vertical" margin={{ top: 4, right: 24, left: 10, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmtK} />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={106}
              />
              <Tooltip content={<BridgeTooltip />} />
              <Bar dataKey="range" radius={[4, 4, 4, 4]} minPointSize={2}>
                {bridge.map((entry) => (
                  <Cell key={entry.key} fill={bridgeColor(entry)} opacity={hasActuals || entry.kind === "endpoint" ? 1 : 0.35} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}

function MetricSummary({
  label,
  value,
  tone,
  suffix = "",
  signed = false,
  muted = false,
}: {
  label: string
  value: number
  tone?: "positive" | "negative"
  suffix?: string
  signed?: boolean
  muted?: boolean
}) {
  const color = tone === "positive"
    ? "text-emerald-700 dark:text-emerald-400"
    : tone === "negative"
      ? "text-red-700 dark:text-red-400"
      : muted
        ? "text-muted-foreground"
        : "text-foreground"
  const prefix = signed && value > 0 ? "+" : ""
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate font-mono text-sm font-semibold tabular-nums", color)}>
        {prefix}{formatAmount(value)}{suffix}
      </div>
    </div>
  )
}

function MonthlyTooltip({
  active,
  payload,
  label,
  metric,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; name?: string | number; value?: number; color?: string; fill?: string }>
  label?: string
  metric: string
}) {
  if (!active || !payload?.length) return null
  const budget = payload.find((item) => item.dataKey === "budget")?.value ?? 0
  const actual = payload.find((item) => item.dataKey === "actual")?.value ?? 0
  const variance = actual - budget
  return (
    <div className="min-w-[190px] rounded-lg border bg-popover p-3 text-xs shadow-lg">
      <div className="mb-2 border-b pb-1.5 font-semibold text-popover-foreground">
        {metric} · {label}
      </div>
      <TooltipRow label="Budget" value={budget} color={BUDGET_COLORS.planIndigo} />
      <TooltipRow label="Actual" value={actual} color={BUDGET_COLORS.actualGreen} />
      <TooltipRow label="Variance" value={variance} color={variance >= 0 ? BUDGET_COLORS.positive : BUDGET_COLORS.negative} signed />
    </div>
  )
}

function BridgeTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: EbitdaBridgeStep }>
}) {
  const item = payload?.[0]?.payload
  if (!active || !item) return null
  return (
    <div className="min-w-[190px] rounded-lg border bg-popover p-3 text-xs shadow-lg">
      <div className="mb-2 border-b pb-1.5 font-semibold text-popover-foreground">{item.label}</div>
      {item.kind === "endpoint" ? (
        <TooltipRow label="EBITDA" value={item.value} color={bridgeColor(item)} />
      ) : (
        <>
          <TooltipRow label="Impact" value={item.delta} color={bridgeColor(item)} signed />
          <TooltipRow label="Running EBITDA" value={item.value} color={BUDGET_COLORS.neutral} />
        </>
      )}
    </div>
  )
}

function TooltipRow({
  label,
  value,
  color,
  signed = false,
}: {
  label: string
  value: number
  color: string
  signed?: boolean
}) {
  const prefix = signed && value > 0 ? "+" : ""
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </div>
      <span className="font-mono font-semibold tabular-nums text-popover-foreground">
        {prefix}{formatAmount(value)}
      </span>
    </div>
  )
}

function bridgeColor(step: EbitdaBridgeStep): string {
  if (step.kind === "endpoint") return step.key === "budget" ? BUDGET_COLORS.planIndigo : BUDGET_COLORS.actualGreen
  return step.kind === "positive" ? BUDGET_COLORS.positive : BUDGET_COLORS.negative
}

function formatAmount(value: number): string {
  const sign = value < 0 ? "-" : ""
  return `${sign}${fmtK(Math.abs(value))} AZN`
}
