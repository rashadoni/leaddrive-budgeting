"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CalendarRange, Lock, Unlock, Sparkles, Loader2, TrendingUp, TrendingDown, ArrowRight } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, ReferenceLine } from "recharts"
import { BUDGET_COLORS, ANIMATION, AXIS_TICK, fmtK, VBarGradient } from "@/lib/budget-chart-theme"
import { AnimatedNumber, fmtManat } from "@/components/animated-number"

interface MonthData {
  year: number
  month: number
  status: string
  revenue: number
  expense: number
  margin: number
  total: number
}

interface Props {
  months: MonthData[]
  totalRevenue: number
  totalExpense: number
  totalMargin: number
  onCloseMonth?: (year: number, month: number) => void
  onReopenMonth?: (year: number, month: number) => void
  onAutoForecast?: () => void
  isClosingMonth?: boolean
  isReopeningMonth?: boolean
  isForecasting?: boolean
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function fmtShort(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (abs >= 1000000) return sign + (abs / 1000000).toFixed(1) + "M"
  if (abs >= 1000) return sign + (abs / 1000).toFixed(0) + "K"
  return sign + abs.toFixed(0)
}

export function BudgetRollingForecast({
  months,
  totalRevenue,
  totalExpense,
  totalMargin,
  onCloseMonth,
  onReopenMonth,
  onAutoForecast,
  isClosingMonth,
  isReopeningMonth,
  isForecasting,
}: Props) {
  if (!months.length) return null

  const firstForecastIdx = months.findIndex((m) => m.status === "forecast")
  const lastActualIdx = firstForecastIdx > 0 ? firstForecastIdx - 1 : (months.every(m => m.status === "actual") ? months.length - 1 : -1)

  const actualMonths = months.filter((m) => m.status === "actual")
  const forecastMonths = months.filter((m) => m.status === "forecast")

  const factRevenue = actualMonths.reduce((s, m) => s + m.revenue, 0)
  const factExpense = actualMonths.reduce((s, m) => s + m.expense, 0)
  const factMargin = factRevenue - factExpense

  const prognozRevenue = forecastMonths.reduce((s, m) => s + m.revenue, 0)
  const prognozExpense = forecastMonths.reduce((s, m) => s + m.expense, 0)
  const prognozMargin = prognozRevenue - prognozExpense

  const marginPct = totalRevenue > 0 ? (totalMargin / totalRevenue * 100) : 0
  const completionPct = months.length > 0 ? Math.round(actualMonths.length / months.length * 100) : 0

  // Chart data
  const chartData = months.map((m) => ({
    name: MONTH_NAMES[m.month - 1],
    revenue: m.revenue,
    expense: m.expense,
    margin: m.margin,
    isActual: m.status === "actual",
  }))

  // Cumulative margin data for area chart
  let cumulative = 0
  const cumulativeData = months.map((m) => {
    cumulative += m.margin
    return {
      name: MONTH_NAMES[m.month - 1],
      cumMargin: cumulative,
      isActual: m.status === "actual",
    }
  })

  // Find boundary month name for reference line
  const boundaryMonth = firstForecastIdx > 0 ? MONTH_NAMES[months[firstForecastIdx - 1].month - 1] : null

  const CustomBarTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0]?.payload
    if (!d) return null
    return (
      <div className="bg-popover/95 backdrop-blur-sm border border-border rounded-xl p-3.5 shadow-xl text-sm min-w-[180px]">
        <div className="flex items-center gap-2 mb-2 border-b border-border/50 pb-2">
          <span className="font-semibold text-popover-foreground">{d.name}</span>
          <Badge variant={d.isActual ? "default" : "outline"} className="text-[9px]">
            {d.isActual ? "Actual" : "Forecast"}
          </Badge>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground text-xs">Revenue</span>
            <span className="font-mono font-medium text-emerald-500">{fmt(d.revenue)} ₼</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground text-xs">Expenses</span>
            <span className="font-mono font-medium text-red-400">{fmt(d.expense)} ₼</span>
          </div>
          <div className="flex justify-between border-t border-border/50 pt-1.5">
            <span className="text-muted-foreground text-xs">Margin</span>
            <span className={`font-mono font-bold ${d.margin >= 0 ? "text-blue-400" : "text-orange-400"}`}>{fmt(d.margin)} ₼</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CalendarRange className="h-5 w-5" />
            Rolling Forecast
          </h2>
          <p className="text-xs text-muted-foreground">
            {months.length}-month rolling view — {actualMonths.length} actual, {forecastMonths.length} forecast
          </p>
        </div>
        <div className="flex gap-2">
          {onAutoForecast && (
            <Button size="sm" variant="outline" onClick={onAutoForecast} disabled={isForecasting} className="ai-glow">
              {isForecasting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Auto-forecast
            </Button>
          )}
        </div>
      </div>

      {/* KPI Scorecards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {/* Total Revenue */}
        <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Revenue</span>
            <div className="h-8 w-8 rounded-full bg-emerald-200 dark:bg-emerald-800 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <AnimatedNumber value={totalRevenue} className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300" trigger="always" />
          {actualMonths.length > 0 && forecastMonths.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              {fmtShort(factRevenue)} actual + {fmtShort(prognozRevenue)} fc
            </p>
          )}
        </div>

        {/* Total Expenses */}
        <div className="rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Expenses</span>
            <div className="h-8 w-8 rounded-full bg-orange-200 dark:bg-orange-800 flex items-center justify-center">
              <TrendingDown className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
          </div>
          <AnimatedNumber value={totalExpense} className="text-xl font-bold tabular-nums text-orange-700 dark:text-orange-300" trigger="always" />
          {actualMonths.length > 0 && forecastMonths.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              {fmtShort(factExpense)} actual + {fmtShort(prognozExpense)} fc
            </p>
          )}
        </div>

        {/* Margin */}
        <div className={`rounded-xl bg-gradient-to-br p-4 ${totalMargin >= 0 ? "from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800" : "from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800"}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Net Margin</span>
            <div className={`h-8 w-8 rounded-full flex items-center justify-center ${totalMargin >= 0 ? "bg-emerald-200 dark:bg-emerald-800" : "bg-red-200 dark:bg-red-800"}`}>
              <span className={`text-xs font-bold ${totalMargin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>Δ</span>
            </div>
          </div>
          <AnimatedNumber value={totalMargin} className={`text-xl font-bold tabular-nums ${totalMargin >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`} trigger="always" />
          <p className="text-[10px] text-muted-foreground mt-1">
            {marginPct >= 0 ? "+" : ""}{marginPct.toFixed(1)}% margin rate
          </p>
        </div>

        {/* Margin % */}
        <div className={`rounded-xl bg-gradient-to-br p-4 ${marginPct >= 15 ? "from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800" : marginPct >= 0 ? "from-amber-50 to-amber-100 border border-amber-200 dark:from-amber-950/30 dark:to-amber-900/20 dark:border-amber-800" : "from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800"}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Margin %</span>
            <div className={`h-8 w-8 rounded-full flex items-center justify-center ${marginPct >= 15 ? "bg-emerald-200 dark:bg-emerald-800" : marginPct >= 0 ? "bg-amber-200 dark:bg-amber-800" : "bg-red-200 dark:bg-red-800"}`}>
              <span className={`text-xs font-bold ${marginPct >= 15 ? "text-emerald-600 dark:text-emerald-400" : marginPct >= 0 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>%</span>
            </div>
          </div>
          <div className={`text-xl font-bold tabular-nums ${marginPct >= 15 ? "text-emerald-700 dark:text-emerald-300" : marginPct >= 0 ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300"}`}>
            {marginPct.toFixed(1)}%
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${marginPct >= 15 ? "bg-emerald-500" : marginPct >= 0 ? "bg-amber-500" : "bg-red-500"}`}
              style={{ width: `${Math.min(Math.max(marginPct, 0), 100)}%` }}
            />
          </div>
        </div>

        {/* Completion */}
        <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 dark:from-indigo-950/30 dark:to-indigo-900/20 dark:border-indigo-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Completion</span>
            <div className="h-8 w-8 rounded-full bg-indigo-200 dark:bg-indigo-800 flex items-center justify-center">
              <CalendarRange className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>
          <div className="text-xl font-bold tabular-nums text-indigo-700 dark:text-indigo-300">
            {actualMonths.length} / {months.length}
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all duration-700"
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Revenue vs Expenses bar chart */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Revenue vs Expenses by Month</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ left: 5, right: 5, top: 10 }}>
                <defs>
                  <VBarGradient id="roll-rev" color={BUDGET_COLORS.actualGreen} />
                  <VBarGradient id="roll-exp" color={BUDGET_COLORS.negative} />
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/15" vertical={false} />
                <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} tickFormatter={fmtK} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomBarTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
                {boundaryMonth && (
                  <ReferenceLine x={boundaryMonth} stroke={BUDGET_COLORS.forecastAmber} strokeDasharray="6 4" strokeWidth={1.5} label={{ value: "← Actual | Forecast →", position: "top", fontSize: 9, fill: BUDGET_COLORS.forecastAmber }} />
                )}
                <Bar dataKey="revenue" fill="url(#roll-rev)" radius={[3, 3, 0, 0]} animationDuration={ANIMATION.duration} barSize={16} />
                <Bar dataKey="expense" fill="url(#roll-exp)" radius={[3, 3, 0, 0]} animationDuration={ANIMATION.duration} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-6 mt-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-3 h-2 rounded-sm" style={{ background: BUDGET_COLORS.actualGreen }} />Revenue
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-3 h-2 rounded-sm" style={{ background: BUDGET_COLORS.negative }} />Expenses
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cumulative Margin area chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cumulative Margin</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={cumulativeData} margin={{ left: 5, right: 5, top: 10 }}>
                <defs>
                  <linearGradient id="roll-cum-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={BUDGET_COLORS.planIndigo} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={BUDGET_COLORS.planIndigo} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/15" vertical={false} />
                <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} tickFormatter={fmtK} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: number) => [fmt(v) + " ₼", "Cumulative Margin"]}
                  contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))" }}
                />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1} />
                <Area
                  type="monotone"
                  dataKey="cumMargin"
                  stroke={BUDGET_COLORS.planIndigo}
                  strokeWidth={2.5}
                  fill="url(#roll-cum-grad)"
                  animationDuration={ANIMATION.duration}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Timeline Grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarRange className="h-4 w-4" />
            Monthly Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-2">
            {months.map((m, i) => {
              const isActual = m.status === "actual"
              const isNextToClose = !isActual && i === firstForecastIdx
              const isLastActual = isActual && i === lastActualIdx
              return (
                <div
                  key={`${m.year}-${m.month}`}
                  className={`relative rounded-xl border p-3 text-center transition-all duration-300
                    ${isActual
                      ? "bg-gradient-to-b from-blue-50 to-blue-100/50 dark:from-blue-950/40 dark:to-blue-900/20 border-blue-300 dark:border-blue-700 shadow-sm"
                      : isNextToClose
                        ? "bg-gradient-to-b from-amber-50 to-amber-100/30 dark:from-amber-950/30 dark:to-amber-900/10 border-amber-300 dark:border-amber-700 border-dashed"
                        : "bg-card border-border hover:border-muted-foreground/30"
                    }`}
                >
                  {/* Status dot */}
                  <div className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${isActual ? "bg-blue-500" : "bg-muted-foreground/30"}`} />

                  <div className="font-semibold text-xs mb-0.5">
                    {MONTH_NAMES[m.month - 1]}
                  </div>
                  <div className="text-[10px] text-muted-foreground mb-2">{m.year}</div>

                  <div className="space-y-0.5">
                    <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono font-medium">
                      +{fmtShort(m.revenue)}
                    </div>
                    <div className="text-[11px] text-red-500 dark:text-red-400 font-mono font-medium">
                      -{fmtShort(m.expense)}
                    </div>
                    <div className={`font-bold text-xs font-mono pt-0.5 border-t border-border/50 mt-1 ${m.margin >= 0 ? "text-blue-600 dark:text-blue-400" : "text-orange-600 dark:text-orange-400"}`}>
                      {m.margin >= 0 ? "+" : ""}{fmtShort(m.margin)}
                    </div>
                  </div>

                  <Badge className={`text-[8px] mt-2 ${isActual ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-600" : "bg-muted text-muted-foreground border-border"}`} variant="outline">
                    {isActual ? "ACTUAL" : "FORECAST"}
                  </Badge>

                  {/* Close / Reopen buttons */}
                  {isLastActual && onReopenMonth && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-full mt-1.5 text-[9px] px-0 text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                      onClick={() => onReopenMonth(m.year, m.month)}
                      disabled={isReopeningMonth}
                    >
                      {isReopeningMonth ? <Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" /> : <Unlock className="h-2.5 w-2.5 mr-0.5" />}
                      Reopen
                    </Button>
                  )}
                  {isNextToClose && onCloseMonth && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-full mt-1.5 text-[9px] px-0 text-amber-600 hover:text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                      onClick={() => onCloseMonth(m.year, m.month)}
                      disabled={isClosingMonth}
                    >
                      {isClosingMonth ? <Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" /> : <Lock className="h-2.5 w-2.5 mr-0.5" />}
                      Close
                    </Button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Actual → Forecast flow indicator */}
          {actualMonths.length > 0 && forecastMonths.length > 0 && (
            <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-border/50">
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded-full bg-blue-500/20 border border-blue-400" />
                <span className="text-muted-foreground">
                  Actual ({actualMonths.length} mo): <span className="font-mono font-medium text-foreground">{fmtShort(factMargin)} ₼</span> margin
                </span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded border border-muted-foreground/30" />
                <span className="text-muted-foreground">
                  Forecast ({forecastMonths.length} mo): <span className="font-mono font-medium text-foreground">{fmtShort(prognozMargin)} ₼</span> margin
                </span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              <div className="flex items-center gap-2 text-xs">
                <span className={`font-mono font-bold ${totalMargin >= 0 ? "text-blue-600 dark:text-blue-400" : "text-orange-500"}`}>
                  = {fmtShort(totalMargin)} ₼ total
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
