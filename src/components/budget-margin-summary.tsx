"use client"

import { useState, useMemo } from "react"
import { useTranslations } from "next-intl"
import { BUDGET_COLORS, fmt } from "@/lib/budget-chart-theme"

interface BudgetMarginSummaryProps {
  revenuePlan: number
  revenueForecast: number
  revenueActual: number
  expensePlan: number
  expenseForecast: number
  expenseActual: number
  marginPlan: number
  marginForecast: number
  marginActual: number
  className?: string
}

function InlineBar({ label, plan, forecast, actual, maxVal, whatIfActual }: {
  label: string
  plan: number
  forecast: number
  actual: number
  maxVal: number
  whatIfActual?: number
}) {
  const t = useTranslations("budgeting")
  const pct = (v: number) => maxVal > 0 ? Math.min(Math.abs(v) / maxVal * 100, 100) : 0
  const displayActual = whatIfActual ?? actual
  const diffPct = plan !== 0 ? ((displayActual - plan) / plan) * 100 : 0
  const diffColor = Math.abs(diffPct) <= 5 ? BUDGET_COLORS.actualGreen : Math.abs(diffPct) <= 15 ? BUDGET_COLORS.warning : BUDGET_COLORS.negative

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-[10px] font-mono font-bold" style={{ color: diffColor }}>
          {diffPct >= 0 ? "+" : ""}{Math.round(diffPct)}%
        </span>
      </div>
      <div className="space-y-1">
        {/* Plan */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-14 text-right">{t("colPlan")}</span>
          <div className="flex-1 h-2.5 rounded-full bg-muted/50 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct(plan)}%`, backgroundColor: BUDGET_COLORS.planIndigo }}
            />
          </div>
          <span className="text-[10px] font-mono text-muted-foreground w-20 text-right">{fmt(plan)}</span>
        </div>
        {/* Forecast */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-14 text-right">{t("colForecast")}</span>
          <div className="flex-1 h-2.5 rounded-full bg-muted/50 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct(forecast)}%`, backgroundColor: BUDGET_COLORS.forecastAmber }}
            />
          </div>
          <span className="text-[10px] font-mono text-muted-foreground w-20 text-right">{fmt(forecast)}</span>
        </div>
        {/* Actual */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-14 text-right">
            {whatIfActual !== undefined ? t("whatIfLabel") : t("colActual")}
          </span>
          <div className="flex-1 h-2.5 rounded-full bg-muted/50 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct(displayActual)}%`,
                backgroundColor: whatIfActual !== undefined ? BUDGET_COLORS.warning : BUDGET_COLORS.actualGreen,
              }}
            />
          </div>
          <span className="text-[10px] font-mono font-medium w-20 text-right" style={{ color: whatIfActual !== undefined ? BUDGET_COLORS.warning : BUDGET_COLORS.actualGreen }}>
            {fmt(displayActual)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function BudgetMarginSummary({
  revenuePlan, revenueForecast, revenueActual,
  expensePlan, expenseForecast, expenseActual,
  marginPlan, marginForecast, marginActual,
  className,
}: BudgetMarginSummaryProps) {
  const t = useTranslations("budgeting")
  const [whatIfPct, setWhatIfPct] = useState(0)
  const [showWhatIf, setShowWhatIf] = useState(false)

  const adjustedExpenseActual = useMemo(() => expenseActual * (1 + whatIfPct / 100), [expenseActual, whatIfPct])
  const adjustedMarginActual = useMemo(() => revenueActual - adjustedExpenseActual, [revenueActual, adjustedExpenseActual])

  const maxVal = Math.max(revenuePlan, revenueForecast, revenueActual, expensePlan, expenseForecast, expenseActual, Math.abs(marginPlan), Math.abs(marginForecast), Math.abs(marginActual), 1)

  const isWhatIf = showWhatIf && whatIfPct !== 0

  return (
    <div className={className}>
      <div className="space-y-4">
        <InlineBar label={t("plRevenue")} plan={revenuePlan} forecast={revenueForecast} actual={revenueActual} maxVal={maxVal} />
        <InlineBar
          label={t("plExpenses")}
          plan={expensePlan}
          forecast={expenseForecast}
          actual={expenseActual}
          maxVal={maxVal}
          whatIfActual={isWhatIf ? adjustedExpenseActual : undefined}
        />
        <InlineBar
          label={t("rollingMargin")}
          plan={marginPlan}
          forecast={marginForecast}
          actual={marginActual}
          maxVal={maxVal}
          whatIfActual={isWhatIf ? adjustedMarginActual : undefined}
        />
      </div>

      {/* What-if controls */}
      <div className="mt-3 pt-3 border-t border-border/50">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowWhatIf(!showWhatIf); if (showWhatIf) setWhatIfPct(0) }}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-200 ${
              showWhatIf
                ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                : "bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent"
            }`}
          >
            {t("whatIfLabel")}
          </button>
          {showWhatIf && (
            <div className="flex-1 flex items-center gap-2 animate-in fade-in slide-in-from-left-3 duration-200">
              <input
                type="range"
                min={-50}
                max={50}
                step={5}
                value={whatIfPct}
                onChange={e => setWhatIfPct(Number(e.target.value))}
                className="flex-1 h-1 accent-amber-500 cursor-pointer"
              />
              <span className={`text-[10px] font-mono font-bold min-w-[32px] text-right ${
                whatIfPct > 0 ? "text-red-500" : whatIfPct < 0 ? "text-green-500" : "text-muted-foreground"
              }`}>
                {whatIfPct > 0 ? "+" : ""}{whatIfPct}%
              </span>
            </div>
          )}
        </div>
        {isWhatIf && (
          <div className="mt-1.5 text-[10px] animate-in fade-in duration-200">
            <span className="text-muted-foreground">{t("rollingMargin")}: </span>
            <span className={`font-bold font-mono ${adjustedMarginActual >= 0 ? "text-green-500" : "text-red-500"}`}>
              {fmt(adjustedMarginActual)}
            </span>
            <span className="text-muted-foreground"> ({adjustedMarginActual - marginActual >= 0 ? "+" : ""}{fmt(adjustedMarginActual - marginActual)})</span>
          </div>
        )}
      </div>
    </div>
  )
}
