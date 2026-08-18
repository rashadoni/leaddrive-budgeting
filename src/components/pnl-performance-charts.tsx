"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
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
import type { PeriodCoverage } from "@/lib/budgeting/period-coverage"
import { varPct } from "@/lib/budgeting/var-pct"
import { coverageNotice, tParam } from "@/lib/budgeting/period-coverage"
import type {
  EbitdaBridgeStep,
  PnlPerformanceMetric,
  PnlPerformancePoint,
} from "@/lib/budgeting/pnl-performance"

// `labelKey` resolves inside the `budgeting` namespace at render time; the
// tab strip, the chart tooltip title and the summary tiles all read it.
const METRICS: Array<{ key: PnlPerformanceMetric; labelKey: string; favorable: "up" | "down" }> = [
  { key: "revenue", labelKey: "plRevenue", favorable: "up" },
  { key: "cogs", labelKey: "cogs", favorable: "down" },
  { key: "opex", labelKey: "pnlOpEx", favorable: "down" },
  { key: "ebitda", labelKey: "pnlWfEbitda", favorable: "up" },
  { key: "netProfit", labelKey: "pnlNetProfit", favorable: "up" },
]

// Bridge step key → i18n key. `buildEbitdaBridge` is locale-agnostic and
// only hands back the stable `key`.
const BRIDGE_LABEL_KEYS: Record<EbitdaBridgeStep["key"], string> = {
  budget: "pnlBridgeBudgetEbitda",
  revenue: "pnlBridgeRevenueVariance",
  cogs: "pnlBridgeCogsVariance",
  opex: "pnlBridgeOpexVariance",
  otherOperating: "pnlBridgeOtherOperatingVariance",
  da: "pnlBridgeDaAddBack",
  actual: "pnlBridgeActualEbitda",
}

interface PnlPerformanceChartsProps {
  monthly: Record<PnlPerformanceMetric, PnlPerformancePoint[]>
  bridge: EbitdaBridgeStep[]
  hasActuals: boolean
  notices?: string[]
  /**
   * 11.92 — how much of the year each side covers. Optional so every existing
   * caller and fixture keeps rendering unchanged; absent means "say nothing",
   * which is the pre-11.92 behaviour exactly.
   */
  budgetCoverage?: PeriodCoverage
  actualCoverage?: PeriodCoverage
}

export function PnlPerformanceCharts({
  monthly,
  bridge,
  hasActuals,
  notices = [],
  budgetCoverage,
  actualCoverage,
}: PnlPerformanceChartsProps) {
  const t = useTranslations("budgeting")
  const [metric, setMetric] = useState<PnlPerformanceMetric>("ebitda")
  const activeMetric = METRICS.find((item) => item.key === metric) ?? METRICS[3]
  const selectedData = monthly[metric]
  const seriesLabels = {
    budget: t("colBudget"),
    actual: t("colActual"),
    variance: t("colVariance"),
  }
  const bridgeRows = useMemo(
    () => bridge.map((step) => ({ ...step, label: t(BRIDGE_LABEL_KEYS[step.key]) })),
    [bridge, t],
  )
  /**
   * 2026-08-12 — the summary totals are now LIKE FOR LIKE.
   *
   * They used to sum all twelve months on both sides. On this client's data the
   * budget runs Jan–Dec and the actuals stop at May, so the variance tile read
   * `−13.9M AZN · 2%` when most of that gap was simply the seven months that
   * had not happened yet. Both figures were correct and the comparison between
   * them was meaningless; a caveat underneath said so, which is the weakest
   * possible fix — it asks the reader to mentally discount a number the page
   * just told them.
   *
   * So the budget side is now summed over the months the ACTUALS cover, and
   * the variance is a real one: how the months that have happened performed
   * against what they were budgeted to do.
   *
   * The monthly chart below is deliberately NOT filtered. Seeing the remaining
   * budgeted months stand empty is information — it shows what is still ahead —
   * and it is the totals, not the bars, that were making the false claim.
   *
   * Falls back to the full twelve months when coverage is unknown or the two
   * sides already agree, so nothing changes on a complete year.
   */
  const comparableMonths = useMemo(() => {
    if (!hasActuals || actualCoverage == null || actualCoverage.count === 0) return null
    if (budgetCoverage != null && actualCoverage.count === budgetCoverage.count) return null
    return new Set(actualCoverage.months)
  }, [hasActuals, actualCoverage, budgetCoverage])

  /**
   * 2026-08-13 — the monthly chart is cut to the comparable months too.
   *
   * The previous pass scoped only the summary tiles and left the chart at
   * twelve, on the reasoning that empty future months show what is still
   * ahead. The owner's instruction was broader and he was right to repeat it:
   * a chart with twelve budget bars beside five actual bars invites exactly
   * the eyeball comparison the tiles were fixed to stop making. One screen
   * cannot answer the same question two different ways.
   *
   * Only the comparison chart is cut. The plan-only charts further down
   * (revenue vs COGS, margin trends) carry no actual series, so trimming them
   * would hide seven months of budget that legitimately exist rather than
   * correct a comparison.
   */
  const chartData = useMemo(
    () => (comparableMonths == null
      ? selectedData
      : selectedData.filter((_row, index) => comparableMonths.has(index + 1))),
    [selectedData, comparableMonths],
  )

  const annual = useMemo(
    () => selectedData.reduce(
      (acc, row, index) => {
        const inScope = comparableMonths == null || comparableMonths.has(index + 1)
        return {
          budget: acc.budget + (inScope ? row.budget : 0),
          actual: acc.actual + row.actual,
        }
      },
      { budget: 0, actual: 0 },
    ),
    [selectedData, comparableMonths],
  )
  const annualActual = hasActuals ? annual.actual : null
  const annualVariance = hasActuals ? annual.actual - annual.budget : null
  // 2026-08-18 — this suffix sits on the VARIANCE tile, so it must be the
  // variance percent. A local re-implementation of the execution percent
  // (the exact drift exec-pct.ts was extracted to end) lived here without
  // the [0,200] clamp or the zero guard: EBITDA budget −632k / fact +271k
  // rendered "KƏNARLAŞMA +903k · 243%" — an unclamped execution number
  // wearing a deviation label. `varPct` is the canonical deviation formula
  // (+143% for the same pair) and returns null on a zero budget.
  const annualVariancePct = hasActuals ? varPct(annual.actual, annual.budget) : null
  /**
   * 11.92 — the two sides do not necessarily cover the same months, and until
   * now nothing said so. On the client's 2026 data the budget runs Jan–Dec and
   * the actuals stop at May, so the variance tile read `−13.9M AZN · 2%` when
   * most of that gap is simply the seven months that have not happened. Both
   * figures were correct; the comparison was the thing that needed a sentence.
   *
   * Shown only when the two spans actually differ. A caveat on every healthy
   * page is a caveat nobody reads — the same reason `coverageNotice` returns
   * null for a full year.
   */
  const spanMismatch =
    hasActuals &&
    budgetCoverage != null &&
    actualCoverage != null &&
    actualCoverage.count > 0 &&
    actualCoverage.count !== budgetCoverage.count
  const actualSpan = spanMismatch
    ? coverageNotice(actualCoverage, (m) => monthShort(selectedData, m))
    : null
  const varianceIsFavorable = activeMetric.favorable === "up"
    ? (annualVariance ?? 0) >= 0
    : (annualVariance ?? 0) <= 0

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
      <section className="xl:col-span-3 rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">{t("pnlPerformanceTitle")}</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("pnlPerformanceSubtitle")}
            </p>
            {notices.length > 0 ? (
              <div className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                {notices.map((notice) => (
                  <p key={notice}>{notice}</p>
                ))}
              </div>
            ) : !hasActuals && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                {t("pnlNoActualsYet")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted/60 p-1" role="tablist" aria-label={t("pnlMetricTablistAria")}>
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
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <MetricSummary label={seriesLabels.budget} value={annual.budget} emptyLabel={t("pnlNoDataShort")} />
          <MetricSummary label={seriesLabels.actual} value={annualActual} emptyLabel={t("pnlNoDataShort")} muted={!hasActuals} />
          <MetricSummary
            label={seriesLabels.variance}
            value={annualVariance}
            tone={varianceIsFavorable ? "positive" : "negative"}
            emptyLabel={t("pnlWaitingForActuals")}
            suffix={annualVariancePct == null ? "" : ` · ${annualVariancePct >= 0 ? "+" : ""}${annualVariancePct.toFixed(0)}%`}
            signed
          />
        </div>
        {actualSpan && (
          <p
            data-testid="pnl-span-mismatch"
            /* Neutral, not amber. It used to be styled as a warning because it
               WAS one — it apologised for comparing twelve months against five.
               Now the comparison is like for like and this line only states the
               basis, which is a footnote. Amber on a correct screen teaches
               people to ignore amber. It stays rather than going away entirely
               because the KPI tile above still shows the full-year figure, and
               without this line the two would look like the same number
               disagreeing with itself. */
            className="mt-2 text-[11px] text-muted-foreground"
          >
            {t("pnlSpanMismatch", {
              actual: tParam(t, actualSpan.key, actualSpan.params),
              budgetCount: budgetCoverage?.count ?? 12,
            })}
          </p>
        )}

        <div className="mt-4 min-w-0">
          <ResponsiveContainer width="100%" height={300} minWidth={0} minHeight={0}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 18, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmtK} />
              <Tooltip content={<MonthlyTooltip metric={t(activeMetric.labelKey)} hasActuals={hasActuals} labels={seriesLabels} noActualsText={t("pnlNoActualsPeriod")} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="budget" name={seriesLabels.budget} fill={BUDGET_COLORS.planIndigo} radius={[4, 4, 0, 0]} />
              {hasActuals && (
                <>
                  <Bar dataKey="actual" name={seriesLabels.actual} fill={BUDGET_COLORS.actualGreen} radius={[4, 4, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="variance"
                    name={seriesLabels.variance}
                    stroke={BUDGET_COLORS.forecastAmber}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="xl:col-span-2 rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">{t("pnlBridgeTitle")}</h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("pnlBridgeSubtitle")}
            </p>
          </div>
          {!hasActuals && (
            <span className="shrink-0 rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t("pnlBridgeNoActualsBadge")}
            </span>
          )}
        </div>

        {hasActuals ? (
          <div className="mt-4 min-w-0">
            <ResponsiveContainer width="100%" height={340} minWidth={0} minHeight={0}>
              <BarChart data={bridgeRows} layout="vertical" margin={{ top: 4, right: 24, left: 10, bottom: 4 }}>
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
                <Tooltip content={<BridgeTooltip labels={{ ebitda: t("pnlWfEbitda"), impact: t("pnlBridgeImpact"), running: t("pnlBridgeRunningEbitda") }} />} />
                <Bar dataKey="range" radius={[4, 4, 4, 4]} minPointSize={2}>
                  {bridgeRows.map((entry) => (
                    <Cell key={entry.key} fill={bridgeColor(entry)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-4 flex h-[340px] items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center">
            <div className="max-w-[260px]">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Activity className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-foreground">{t("pnlBridgeEmptyTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("pnlBridgeEmptyDescription")}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function MetricSummary({
  label,
  value,
  tone,
  emptyLabel,
  suffix = "",
  signed = false,
  muted = false,
}: {
  label: string
  value: number | null
  tone?: "positive" | "negative"
  emptyLabel: string
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
  const hasValue = value != null
  const prefix = hasValue && signed && value > 0 ? "+" : ""
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate font-mono text-sm font-semibold tabular-nums", color)}>
        {hasValue ? `${prefix}${formatAmount(value)}${suffix}` : emptyLabel}
      </div>
    </div>
  )
}

function MonthlyTooltip({
  active,
  payload,
  label,
  metric,
  hasActuals,
  labels,
  noActualsText,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; name?: string | number; value?: number; color?: string; fill?: string }>
  label?: string
  metric: string
  hasActuals: boolean
  labels: { budget: string; actual: string; variance: string }
  noActualsText: string
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
      <TooltipRow label={labels.budget} value={budget} color={BUDGET_COLORS.planIndigo} />
      {hasActuals ? (
        <>
          <TooltipRow label={labels.actual} value={actual} color={BUDGET_COLORS.actualGreen} />
          <TooltipRow label={labels.variance} value={variance} color={variance >= 0 ? BUDGET_COLORS.positive : BUDGET_COLORS.negative} signed />
        </>
      ) : (
        <div className="mt-2 border-t pt-2 text-xs font-medium text-muted-foreground">
          {noActualsText}
        </div>
      )}
    </div>
  )
}

function BridgeTooltip({
  active,
  payload,
  labels,
}: {
  active?: boolean
  payload?: Array<{ payload?: EbitdaBridgeStep & { label: string } }>
  labels?: { ebitda: string; impact: string; running: string }
}) {
  const item = payload?.[0]?.payload
  if (!active || !item) return null
  return (
    <div className="min-w-[190px] rounded-lg border bg-popover p-3 text-xs shadow-lg">
      <div className="mb-2 border-b pb-1.5 font-semibold text-popover-foreground">{item.label}</div>
      {item.kind === "endpoint" ? (
        <TooltipRow label={labels?.ebitda ?? ""} value={item.value} color={bridgeColor(item)} />
      ) : (
        <>
          <TooltipRow label={labels?.impact ?? ""} value={item.delta} color={bridgeColor(item)} signed />
          <TooltipRow label={labels?.running ?? ""} value={item.value} color={BUDGET_COLORS.neutral} />
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

/**
 * The label the x-axis already prints for a 1-based month. Reading it off the
 * series rather than re-deriving it keeps the caveat and the chart in the same
 * language and the same abbreviation style.
 */
function monthShort(points: PnlPerformancePoint[], month1Based: number): string {
  return points[month1Based - 1]?.month ?? String(month1Based)
}

