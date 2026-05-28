"use client"

import { useEffect, useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("ui:expense-forecast-tab")
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Loader2, Save, TrendingDown, Info, Zap, ChevronDown, ChevronUp } from "lucide-react"
import { DataBoundary } from "@/components/ui/data-boundary"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from "recharts"
import { BUDGET_COLORS, ANIMATION, AXIS_TICK, fmtK, VBarGradient } from "@/lib/budget-chart-theme"
import { AnimatedNumber, fmtManat } from "@/components/animated-number"

interface CostType {
  id: string
  key: string
  label: string
  isShared: boolean
  sortOrder: number
  isActive: boolean
}

interface Department {
  id: string
  key: string
  label: string
  serviceKey: string | null
  sortOrder: number
  isActive: boolean
}

interface ForecastEntry {
  id: string
  costTypeId: string
  departmentId: string | null
  month: number
  amount: number
}

/** A row in the grid: costType + optional department */
interface GridRow {
  costTypeId: string
  departmentId: string | null
  label: string
  costTypeLabel: string
  deptLabel: string | null
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const PIE_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#ec4899"]

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

/** Compose a unique key for grid cell lookup */
function rowKey(costTypeId: string, departmentId: string | null): string {
  return `${costTypeId}__${departmentId ?? "shared"}`
}

export function ExpenseForecastTab() {
  const t = useTranslations("budgeting")
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId

  const [costTypes, setCostTypes] = useState<CostType[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  // grid: { "costTypeId__deptId": { month: amount } }
  const [grid, setGrid] = useState<Record<string, Record<number, number>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [hasCostModel, setHasCostModel] = useState(false)
  const [showQuickFill, setShowQuickFill] = useState(false)
  const [quickFillRow, setQuickFillRow] = useState<string>("")
  const [quickFillAmount, setQuickFillAmount] = useState("")
  const [showTable, setShowTable] = useState(true)

  const headers: Record<string, string> = orgId
    ? { "x-organization-id": String(orgId), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [ctRes, deptRes, fcRes, cmRes] = await Promise.all([
        fetch("/api/budgeting/cost-types?includeInactive=false", { headers }),
        fetch("/api/budgeting/departments?includeInactive=false", { headers }),
        fetch(`/api/budgeting/expense-forecast?year=${year}`, { headers }),
        fetch("/api/cost-model/compute", { headers }).catch(() => null),
      ])

      if (ctRes.ok) {
        const data = (await ctRes.json()).data || []
        setCostTypes(data.filter((ct: CostType) => ct.isActive))
      }

      if (deptRes.ok) {
        const data = (await deptRes.json()).data || []
        setDepartments(data.filter((d: Department) => d.isActive))
      }

      // Check if cost model has data
      if (cmRes && cmRes.ok) {
        const cmData = await cmRes.json()
        setHasCostModel(!!cmData?.data?.grandTotalG && cmData.data.grandTotalG > 0)
      } else {
        setHasCostModel(false)
      }

      const newGrid: Record<string, Record<number, number>> = {}
      if (fcRes.ok) {
        const entries: ForecastEntry[] = (await fcRes.json()).data || []
        for (const e of entries) {
          const key = rowKey(e.costTypeId, e.departmentId)
          if (!newGrid[key]) newGrid[key] = {}
          newGrid[key][e.month] = e.amount
        }
      }
      setGrid(newGrid)
    } catch (err) {
      log.error("Failed to load expense forecast data", {
        year,
        err: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoading(false)
    }
  }, [year, orgId])

  useEffect(() => {
    if (session) fetchData()
  }, [session, fetchData])

  // Build grid rows from costType × department
  const gridRows: GridRow[] = []
  for (const ct of costTypes) {
    if (ct.isShared) {
      gridRows.push({
        costTypeId: ct.id,
        departmentId: null,
        label: ct.label,
        costTypeLabel: ct.label,
        deptLabel: null,
      })
    } else {
      for (const dept of departments) {
        if (!dept.serviceKey) continue
        gridRows.push({
          costTypeId: ct.id,
          departmentId: dept.id,
          label: `${ct.label} — ${dept.label}`,
          costTypeLabel: ct.label,
          deptLabel: dept.label,
        })
      }
    }
  }

  const getVal = (rk: string, month: number): number => grid[rk]?.[month] || 0

  const setCell = (rk: string, month: number, value: number) => {
    setGrid((prev) => ({
      ...prev,
      [rk]: { ...(prev[rk] || {}), [month]: value },
    }))
    setSaved(false)
  }

  const rowTotal = (rk: string): number => {
    const row = grid[rk] || {}
    return Object.values(row).reduce((s, v) => s + (v || 0), 0)
  }

  const colTotal = (month: number): number =>
    gridRows.reduce((s, r) => s + getVal(rowKey(r.costTypeId, r.departmentId), month), 0)

  const grandTotal = (): number =>
    gridRows.reduce((s, r) => s + rowTotal(rowKey(r.costTypeId, r.departmentId)), 0)

  // Quick fill: distribute annual amount evenly across 12 months
  const applyQuickFill = () => {
    if (!quickFillRow || !quickFillAmount) return
    const annual = Number(quickFillAmount)
    if (!annual) return
    const monthly = Math.round(annual / 12)
    setGrid((prev) => {
      const months: Record<number, number> = {}
      for (let m = 1; m <= 12; m++) months[m] = monthly
      return { ...prev, [quickFillRow]: months }
    })
    setSaved(false)
    setQuickFillAmount("")
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const entries: Array<{ costTypeId: string; departmentId: string | null; month: number; amount: number }> = []
      for (const row of gridRows) {
        const rk = rowKey(row.costTypeId, row.departmentId)
        for (let m = 1; m <= 12; m++) {
          entries.push({
            costTypeId: row.costTypeId,
            departmentId: row.departmentId,
            month: m,
            amount: grid[rk]?.[m] || 0,
          })
        }
      }
      const res = await fetch("/api/budgeting/expense-forecast", {
        method: "POST",
        headers,
        body: JSON.stringify({ year, entries }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (err) {
      log.error("Failed to save expense forecast", {
        year,
        err: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSaving(false)
    }
  }

  // Computed values for KPIs
  const total = grandTotal()
  const avgMonthly = total / 12

  // Top cost category by cost type (aggregate across departments)
  const costTypeTotals: Record<string, { label: string; total: number }> = {}
  for (const row of gridRows) {
    const rk = rowKey(row.costTypeId, row.departmentId)
    const t = rowTotal(rk)
    if (!costTypeTotals[row.costTypeId]) {
      costTypeTotals[row.costTypeId] = { label: row.costTypeLabel, total: 0 }
    }
    costTypeTotals[row.costTypeId].total += t
  }
  const topCostType = Object.values(costTypeTotals).sort((a, b) => b.total - a.total)[0]

  const sharedCount = gridRows.filter(r => !r.departmentId).length
  const deptCount = gridRows.filter(r => r.departmentId).length

  // Monthly trend data
  const monthlyData = MONTHS.map((name, i) => ({
    name,
    expenses: colTotal(i + 1),
  }))

  // Expense breakdown by cost type for pie
  const pieData = Object.values(costTypeTotals)
    .filter(d => d.total > 0)
    .sort((a, b) => b.total - a.total)

  if (loading) {
    return <DataBoundary loading>{null}</DataBoundary>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Expense Forecast
          </h2>
          <p className="text-xs text-muted-foreground">
            Monthly expense forecast by cost types and departments.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[2025, 2026, 2027, 2028].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => setShowQuickFill(!showQuickFill)}>
            <Zap className="h-4 w-4 mr-1" />
            Quick Fill
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {saved ? t("forecastSaved") : t("forecastSave")}
          </Button>
        </div>
      </div>

      {/* KPI Scorecards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Total Expenses */}
        <div className="rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t("forecastTotalExpenses")}</span>
            <div className="h-8 w-8 rounded-full bg-orange-200 dark:bg-orange-800 flex items-center justify-center">
              <TrendingDown className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
          </div>
          <AnimatedNumber value={total} className="text-2xl font-bold tabular-nums text-orange-700 dark:text-orange-300" trigger="always" />
          <p className="text-[10px] text-muted-foreground mt-1">{year} forecast</p>
        </div>

        {/* Avg Monthly */}
        <div className="rounded-xl bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t("forecastAvgMonthly")}</span>
            <div className="h-8 w-8 rounded-full bg-red-200 dark:bg-red-800 flex items-center justify-center">
              <span className="text-xs font-bold text-red-600 dark:text-red-400">μ</span>
            </div>
          </div>
          <AnimatedNumber value={avgMonthly} className="text-2xl font-bold tabular-nums text-red-700 dark:text-red-300" trigger="always" />
          <p className="text-[10px] text-muted-foreground mt-1">per month average</p>
        </div>

        {/* Top Cost Type */}
        <div className="rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 dark:from-amber-950/30 dark:to-amber-900/20 dark:border-amber-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t("forecastTopCostType")}</span>
            <div className="h-8 w-8 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center">
              <span className="text-xs font-bold text-amber-600 dark:text-amber-400">★</span>
            </div>
          </div>
          <AnimatedNumber value={topCostType?.total || 0} className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-300" trigger="always" />
          <p className="text-[10px] text-muted-foreground mt-1 truncate">{topCostType?.label || "—"}</p>
        </div>

        {/* Categories */}
        <div className="rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t("forecastCategories")}</span>
            <div className="h-8 w-8 rounded-full bg-violet-200 dark:bg-violet-800 flex items-center justify-center">
              <span className="text-xs font-bold text-violet-600 dark:text-violet-400">#</span>
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-violet-700 dark:text-violet-300">{gridRows.length}</div>
          <p className="text-[10px] text-muted-foreground mt-1">{sharedCount} shared + {deptCount} dept-specific</p>
        </div>
      </div>

      {/* Cost model info banner */}
      {hasCostModel && (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-4 py-3">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-800 dark:text-blue-300">
            <strong>Cost Model is active.</strong> Planned budget expenses are calculated automatically from the cost model.
            The expense forecast is used as a fallback — if the cost model does not contain data for a category,
            the forecast from this table will be used.
          </div>
        </div>
      )}

      {/* Quick Fill Panel */}
      {showQuickFill && (
        <Card className="border-dashed border-orange-300 dark:border-orange-700 bg-orange-50/50 dark:bg-orange-950/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <Zap className="h-4 w-4 text-orange-500 shrink-0" />
              <span className="text-sm font-medium whitespace-nowrap">{t("forecastQuickFillLabel")}</span>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[220px]"
                value={quickFillRow}
                onChange={(e) => setQuickFillRow(e.target.value)}
              >
                <option value="">{t("forecastSelectCategory")}</option>
                {gridRows.map((r) => {
                  const rk = rowKey(r.costTypeId, r.departmentId)
                  return (
                    <option key={rk} value={rk}>{r.label}</option>
                  )
                })}
              </select>
              <Input
                type="number"
                placeholder={t("forecastQuickFillAmount")}
                className="h-9 w-[160px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                value={quickFillAmount}
                onChange={(e) => setQuickFillAmount(e.target.value)}
              />
              <Button size="sm" onClick={applyQuickFill} disabled={!quickFillRow || !quickFillAmount}>
                {t("forecastQuickFillDistribute")}
              </Button>
              <span className="text-xs text-muted-foreground">{t("forecastQuickFillSplits")}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts Row */}
      {total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Monthly Expense Trend */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("forecastMonthlyExpenseTrend")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyData} margin={{ left: 5, right: 5, top: 10 }}>
                  <defs>
                    <VBarGradient id="ef-exp-grad" color={BUDGET_COLORS.expenseActual} />
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/15" vertical={false} />
                  <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} tickFormatter={fmtK} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={((v: number) => [fmt(v) + " ₼", "Expenses"]) as never}
                    contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))" }}
                  />
                  <Bar dataKey="expenses" fill="url(#ef-exp-grad)" radius={[4, 4, 0, 0]} animationDuration={ANIMATION.duration} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Expense Breakdown Donut */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("forecastExpenseBreakdown")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="45%"
                    innerRadius={45}
                    outerRadius={75}
                    dataKey="total"
                    nameKey="label"
                    paddingAngle={2}
                    animationDuration={ANIMATION.duration}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={((v: number) => [fmt(v) + " ₼"]) as never}
                    contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))" }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center -mt-2">
                {pieData.slice(0, 6).map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10px]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-muted-foreground truncate max-w-[80px]">{d.label}</span>
                    <span className="font-mono text-foreground">{total > 0 ? Math.round(d.total / total * 100) : 0}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Grid */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle
              className="text-sm flex items-center gap-2 cursor-pointer select-none"
              onClick={() => setShowTable(!showTable)}
            >
              {showTable ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {year} — {gridRows.length} expense categories
            </CardTitle>
            <span className="text-xs text-muted-foreground">Amounts in AZN</span>
          </div>
        </CardHeader>
        {showTable && (
          <CardContent>
            {gridRows.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                No active cost types. Add them in the Settings section.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left p-2 border font-medium sticky left-0 bg-muted/50 min-w-[200px] z-10">
                        Category
                      </th>
                      {MONTHS.map((m, i) => (
                        <th key={i} className="text-right p-2 border font-medium min-w-[95px]">
                          {m}
                        </th>
                      ))}
                      <th className="text-right p-2 border font-semibold min-w-[110px] bg-red-50 dark:bg-red-950">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {gridRows.map((row) => {
                      const rk = rowKey(row.costTypeId, row.departmentId)
                      return (
                        <tr key={rk} className="hover:bg-muted/30">
                          <td className="p-2 border font-medium sticky left-0 bg-background z-10">
                            <div className="flex items-center gap-2">
                              <span className="truncate">{row.label}</span>
                              {!row.departmentId && (
                                <Badge variant="outline" className="text-[9px] shrink-0">shared</Badge>
                              )}
                            </div>
                          </td>
                          {MONTHS.map((_, mi) => {
                            const month = mi + 1
                            const val = getVal(rk, month)
                            return (
                              <td key={mi} className="p-1 border">
                                <Input
                                  type="number"
                                  className="h-8 text-right text-xs tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  value={val ? Math.round(val) : ""}
                                  placeholder="0"
                                  onChange={(e) => setCell(rk, month, Number(e.target.value) || 0)}
                                />
                              </td>
                            )
                          })}
                          <td className="p-2 border text-right font-semibold tabular-nums bg-red-50 dark:bg-red-950">
                            {fmt(rowTotal(rk))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/70 font-semibold">
                      <td className="p-2 border sticky left-0 bg-muted/70 z-10">TOTAL</td>
                      {MONTHS.map((_, mi) => (
                        <td key={mi} className="p-2 border text-right tabular-nums">
                          {fmt(colTotal(mi + 1))}
                        </td>
                      ))}
                      <td className="p-2 border text-right tabular-nums bg-red-100 dark:bg-red-900">
                        {fmt(grandTotal())}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}
