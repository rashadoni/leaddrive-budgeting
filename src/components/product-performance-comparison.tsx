"use client"

import { useMemo } from "react"
import {
  missingDataKey,
  missingDataParams,
  type MissingDataNotice,
} from "@/lib/budgeting/missing-data"
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { AlertCircle, BarChart3 } from "lucide-react"
import { useTranslations } from "next-intl"
import { BUDGET_COLORS, fmtK } from "@/lib/budget-chart-theme"
import {
  buildProductVarianceRows,
  productVarianceCoverage,
  type ProductVarianceInputLine,
} from "@/lib/budgeting/product-variance"
import { cn } from "@/lib/utils"

interface ProductPerformanceComparisonProps {
  title: string
  description: string
  budgetLines: ProductVarianceInputLine[]
  actualLines: ProductVarianceInputLine[]
  missingData?: MissingDataNotice[]
  amountLabel: string
  rateVarianceLabel: string
  volumeVarianceLabel?: string
  favorable: "up" | "down"
}

export function ProductPerformanceComparison({
  title,
  description,
  budgetLines,
  actualLines,
  missingData = [],
  amountLabel,
  rateVarianceLabel,
  volumeVarianceLabel,
  favorable,
}: ProductPerformanceComparisonProps) {
  const t = useTranslations("budgeting")
  const tCommon = useTranslations("common")
  const MONTHS = useMemo(() => t("monthsShort").split(","), [t])
  const volumeLabel = volumeVarianceLabel ?? t("varianceVolume")
  /**
   * 2026-08-13 — like for like, same rule as the P&L tab.
   *
   * This screen had the identical flaw: a twelve-month sales budget compared
   * against five months of actuals, printing `49.5M / 8.5M / −41.0M` with the
   * gap read as underperformance when most of it is months that have not
   * happened. The owner found it after the P&L was fixed, which is the useful
   * kind of finding — the same mistake was made twice, in two components.
   *
   * The budget lines are scoped to the months that carry actuals BEFORE
   * anything is derived from them, so the tiles, the per-product table and the
   * monthly chart all agree by construction rather than by three separate
   * filters that can drift apart.
   *
   * A month counts when it carries a non-zero actual — same reading as
   * `coverageOf` on the P&L side, where zero is treated as absent because the
   * monthly maps are dense and zero-filled. With no actuals at all, or a full
   * twelve, nothing is scoped and the screen behaves as before.
   */
  const actualMonths = useMemo(() => {
    const months = new Set<number>()
    for (const line of actualLines) if (line.amount !== 0) months.add(line.month)
    return months
  }, [actualLines])
  const budgetMonths = useMemo(() => {
    const months = new Set<number>()
    for (const line of budgetLines) if (line.amount !== 0) months.add(line.month)
    return months
  }, [budgetLines])
  const scopeToActuals = actualMonths.size > 0 && actualMonths.size !== budgetMonths.size
  const scopedBudgetLines = useMemo(
    () => (scopeToActuals ? budgetLines.filter((line) => actualMonths.has(line.month)) : budgetLines),
    [scopeToActuals, budgetLines, actualMonths],
  )

  const rows = useMemo(
    () => buildProductVarianceRows({ budgetLines: scopedBudgetLines, actualLines }),
    [scopedBudgetLines, actualLines],
  )
  const coverage = useMemo(() => productVarianceCoverage(rows), [rows])
  // 11.90 — the server sends a code and the reader's locale turns it into a
  // sentence. It used to send English prose straight onto an Azerbaijani page.
  const notices = unique([
    ...missingData.map((n) =>
      t(
        missingDataKey(n) as never,
        missingDataParams(n, (d) => t(`missing.dataset.${d}` as never)) as never,
      ),
    ),
    ...coverage.missingCodes.map((code) => t(`productVarianceMissing.${code}`)),
  ])
  const monthlyData = useMemo(() => MONTHS
    .map((month, index) => {
      const m = index + 1
      const budget = scopedBudgetLines.filter((line) => line.month === m).reduce((sum, line) => sum + line.amount, 0)
      const actual = actualLines.filter((line) => line.month === m).reduce((sum, line) => sum + line.amount, 0)
      return { month, monthNumber: m, budget, actual, variance: actual - budget }
    })
    .filter((row) => !scopeToActuals || actualMonths.has(row.monthNumber)),
    [MONTHS, scopedBudgetLines, actualLines, scopeToActuals, actualMonths])
  const totals = rows.reduce(
    (acc, row) => ({
      budget: acc.budget + row.budgetAmount,
      actual: acc.actual + row.actualAmount,
      variance: acc.variance + row.variance,
    }),
    { budget: 0, actual: 0, variance: 0 },
  )
  const varianceGood = favorable === "up" ? totals.variance >= 0 : totals.variance <= 0
  const topRows = rows.slice(0, 8)
  const seriesLabels = {
    budget: t("colBudget"),
    actual: t("colActual"),
    variance: t("colVariance"),
  }

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs lg:min-w-[460px]">
          <SummaryBox label={t("colBudget")} value={totals.budget} />
          <SummaryBox label={t("colActual")} value={totals.actual} muted={!coverage.hasActual} />
          <SummaryBox label={t("colVariance")} value={totals.variance} signed tone={varianceGood ? "positive" : "negative"} />
        </div>
      </div>

      {notices.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="space-y-1">
              {notices.map((notice) => (
                <p key={notice}>{notice}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={260} minWidth={0} minHeight={0}>
              <ComposedChart data={monthlyData} margin={{ top: 8, right: 18, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmtK} />
                <Tooltip content={<MonthlyComparisonTooltip amountLabel={amountLabel} favorable={favorable} labels={seriesLabels} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="budget" name={seriesLabels.budget} fill={BUDGET_COLORS.planIndigo} radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name={seriesLabels.actual} fill={BUDGET_COLORS.actualGreen} radius={[4, 4, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="variance"
                  name={seriesLabels.variance}
                  stroke={BUDGET_COLORS.forecastAmber}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="xl:col-span-2">
          <div className="rounded-lg border bg-muted/10">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 border-b px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
              <span>{tCommon("product")}</span>
              <span className="text-right">{t("colActual")}</span>
              <span className="text-right">{t("colBudget")}</span>
              <span className="text-right">{t("colVarianceShort")}</span>
            </div>
            <div className="max-h-[260px] overflow-y-auto">
              {topRows.length > 0 ? topRows.map((row) => {
                const rowGood = favorable === "up" ? row.variance >= 0 : row.variance <= 0
                return (
                  <div
                    key={row.productId}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2 border-b px-3 py-2 text-xs last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground" title={row.productName}>{row.productName}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {row.hasRateVolume
                          ? `${rateVarianceLabel}: ${formatSigned(row.rateVariance ?? 0)} · ${volumeLabel}: ${formatSigned(row.volumeVariance ?? 0)}`
                          : t("priceVolumeUnavailable")}
                      </div>
                    </div>
                    <span className="font-mono tabular-nums text-foreground">{formatShort(row.actualAmount)}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{formatShort(row.budgetAmount)}</span>
                    <span className={cn("font-mono font-semibold tabular-nums", rowGood ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                      {formatSigned(row.variance)}
                    </span>
                  </div>
                )
              }) : (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {t("productComparisonEmpty")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function SummaryBox({
  label,
  value,
  tone,
  signed = false,
  muted = false,
}: {
  label: string
  value: number
  tone?: "positive" | "negative"
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

  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate font-mono text-sm font-semibold tabular-nums", color)}>
        {signed ? formatSigned(value) : `${formatShort(value)} AZN`}
      </div>
    </div>
  )
}

function MonthlyComparisonTooltip({
  active,
  payload,
  label,
  amountLabel,
  favorable,
  labels,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number }>
  label?: string
  amountLabel: string
  favorable: "up" | "down"
  labels: { budget: string; actual: string; variance: string }
}) {
  if (!active || !payload?.length) return null
  const budget = payload.find((item) => item.dataKey === "budget")?.value ?? 0
  const actual = payload.find((item) => item.dataKey === "actual")?.value ?? 0
  const variance = actual - budget
  const good = favorable === "up" ? variance >= 0 : variance <= 0

  return (
    <div className="min-w-[200px] rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
      <div className="mb-2 border-b pb-1.5 font-semibold">{amountLabel} · {label}</div>
      <TooltipRow label={labels.budget} value={budget} color={BUDGET_COLORS.planIndigo} />
      <TooltipRow label={labels.actual} value={actual} color={BUDGET_COLORS.actualGreen} />
      <TooltipRow label={labels.variance} value={variance} color={good ? BUDGET_COLORS.positive : BUDGET_COLORS.negative} signed />
    </div>
  )
}

function TooltipRow({ label, value, color, signed = false }: { label: string; value: number; color: string; signed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </div>
      <span className="font-mono font-semibold tabular-nums">
        {signed ? formatSigned(value) : `${formatShort(value)} AZN`}
      </span>
    </div>
  )
}

function formatSigned(value: number): string {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : ""
  return `${prefix}${formatShort(Math.abs(value))} AZN`
}

function formatShort(value: number): string {
  return fmtK(Math.abs(value))
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}
