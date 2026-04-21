"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Save, TrendingUp, Zap, ChevronDown, ChevronUp } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from "recharts"
import { BUDGET_COLORS, ANIMATION, AXIS_TICK, fmtK, VBarGradient } from "@/lib/budget-chart-theme"
import { AnimatedNumber, fmtManat } from "@/components/animated-number"

interface Department {
  id: string
  key: string
  label: string
  hasRevenue: boolean
  sortOrder: number
  isActive: boolean
}

interface ForecastEntry {
  id: string
  departmentId: string
  month: number
  amount: number
  budgetDept: { id: string; key: string; label: string }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const VAT_RATE = 0.18

const PIE_COLORS = ["#6366f1", "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#22c55e", "#f59e0b", "#f97316", "#ec4899", "#a855f7"]

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function SalesForecastTab() {
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId

  const [departments, setDepartments] = useState<Department[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [grid, setGrid] = useState<Record<string, Record<number, number>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showVat, setShowVat] = useState(false)
  const [showQuickFill, setShowQuickFill] = useState(false)
  const [quickFillDept, setQuickFillDept] = useState<string>("")
  const [quickFillAmount, setQuickFillAmount] = useState("")
  const [showTable, setShowTable] = useState(true)

  const headers: Record<string, string> = orgId
    ? { "x-organization-id": String(orgId), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [deptRes, fcRes] = await Promise.all([
        fetch("/api/budgeting/departments?includeInactive=false", { headers }),
        fetch(`/api/budgeting/sales-forecast?year=${year}`, { headers }),
      ])

      if (deptRes.ok) {
        const deptData = (await deptRes.json()).data || []
        setDepartments(deptData.filter((d: Department) => d.hasRevenue && d.isActive))
      }

      const newGrid: Record<string, Record<number, number>> = {}
      if (fcRes.ok) {
        const entries: ForecastEntry[] = (await fcRes.json()).data || []
        for (const e of entries) {
          if (!newGrid[e.departmentId]) newGrid[e.departmentId] = {}
          newGrid[e.departmentId][e.month] = e.amount
        }
      }
      setGrid(newGrid)
    } catch (err) {
      console.error("Failed to load forecast data:", err)
    } finally {
      setLoading(false)
    }
  }, [year, orgId])

  useEffect(() => {
    if (session) fetchData()
  }, [session, fetchData])

  const getVal = (deptId: string, month: number): number => {
    const base = grid[deptId]?.[month] || 0
    return showVat ? base * (1 + VAT_RATE) : base
  }

  const setCell = (deptId: string, month: number, displayValue: number) => {
    const storeValue = showVat ? displayValue / (1 + VAT_RATE) : displayValue
    setGrid((prev) => ({
      ...prev,
      [deptId]: { ...(prev[deptId] || {}), [month]: storeValue },
    }))
    setSaved(false)
  }

  const rowTotal = (deptId: string): number => {
    const row = grid[deptId] || {}
    const base = Object.values(row).reduce((s, v) => s + (v || 0), 0)
    return showVat ? base * (1 + VAT_RATE) : base
  }

  const colTotal = (month: number): number =>
    departments.reduce((s, d) => s + getVal(d.id, month), 0)

  const grandTotal = (): number =>
    departments.reduce((s, d) => s + rowTotal(d.id), 0)

  const colVat = (month: number): number =>
    departments.reduce((s, d) => s + (grid[d.id]?.[month] || 0) * VAT_RATE, 0)

  const rowVat = (deptId: string): number => {
    const row = grid[deptId] || {}
    return Object.values(row).reduce((s, v) => s + (v || 0), 0) * VAT_RATE
  }

  const grandVat = (): number =>
    departments.reduce((s, d) => s + rowVat(d.id), 0)

  // Quick fill: distribute annual amount evenly across 12 months
  const applyQuickFill = () => {
    if (!quickFillDept || !quickFillAmount) return
    const annual = Number(quickFillAmount)
    if (!annual) return
    const monthly = Math.round(annual / 12)
    setGrid((prev) => {
      const months: Record<number, number> = {}
      for (let m = 1; m <= 12; m++) months[m] = monthly
      return { ...prev, [quickFillDept]: months }
    })
    setSaved(false)
    setQuickFillAmount("")
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const entries: Array<{ departmentId: string; month: number; amount: number }> = []
      for (const dept of departments) {
        for (let m = 1; m <= 12; m++) {
          entries.push({ departmentId: dept.id, month: m, amount: grid[dept.id]?.[m] || 0 })
        }
      }
      const res = await fetch("/api/budgeting/sales-forecast", {
        method: "POST",
        headers,
        body: JSON.stringify({ year, entries }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (err) {
      console.error("Failed to save forecast:", err)
    } finally {
      setSaving(false)
    }
  }

  // Computed values for KPIs and charts
  const total = grandTotal()
  const avgMonthly = total / 12
  const topDept = departments.reduce((best, d) => {
    const t = rowTotal(d.id)
    return t > (best.total || 0) ? { dept: d, total: t } : best
  }, { dept: null as Department | null, total: 0 })

  const filledMonths = new Set<number>()
  for (const deptId of Object.keys(grid)) {
    for (const [m, v] of Object.entries(grid[deptId] || {})) {
      if (v > 0) filledMonths.add(Number(m))
    }
  }

  // Monthly trend chart data
  const monthlyData = MONTHS.map((name, i) => ({
    name,
    revenue: colTotal(i + 1),
  }))

  // Revenue mix pie data
  const pieData = departments
    .map((d) => ({ name: d.label, value: rowTotal(d.id) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (departments.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No revenue departments configured</p>
          <p className="text-sm mt-1">Import an Excel budget file to create departments and sales forecasts automatically.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Sales Forecast
          </h2>
          <p className="text-xs text-muted-foreground">
            Annual revenue forecast by services. Stored without VAT — toggle to display with VAT (18%).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showVat}
              onChange={(e) => setShowVat(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Incl. VAT (18%)
          </label>
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
            {saved ? "Saved ✓" : "Save"}
          </Button>
        </div>
      </div>

      {/* KPI Scorecards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Total Revenue */}
        <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 dark:from-indigo-950/30 dark:to-indigo-900/20 dark:border-indigo-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Total Revenue</span>
            <div className="h-8 w-8 rounded-full bg-indigo-200 dark:bg-indigo-800 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
          </div>
          <AnimatedNumber value={total} className="text-2xl font-bold tabular-nums text-indigo-700 dark:text-indigo-300" trigger="always" />
          <p className="text-[10px] text-muted-foreground mt-1">{year} forecast {showVat ? "incl. VAT" : "excl. VAT"}</p>
        </div>

        {/* Avg Monthly */}
        <div className="rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 dark:from-blue-950/30 dark:to-blue-900/20 dark:border-blue-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Avg Monthly</span>
            <div className="h-8 w-8 rounded-full bg-blue-200 dark:bg-blue-800 flex items-center justify-center">
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">μ</span>
            </div>
          </div>
          <AnimatedNumber value={avgMonthly} className="text-2xl font-bold tabular-nums text-blue-700 dark:text-blue-300" trigger="always" />
          <p className="text-[10px] text-muted-foreground mt-1">per month average</p>
        </div>

        {/* Top Service */}
        <div className="rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 dark:from-amber-950/30 dark:to-amber-900/20 dark:border-amber-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Top Service</span>
            <div className="h-8 w-8 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center">
              <span className="text-xs font-bold text-amber-600 dark:text-amber-400">★</span>
            </div>
          </div>
          <AnimatedNumber value={topDept.total} className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-300" trigger="always" />
          <p className="text-[10px] text-muted-foreground mt-1 truncate">{topDept.dept?.label || "—"}</p>
        </div>

        {/* Services Count */}
        <div className="rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 border border-violet-200 dark:from-violet-950/30 dark:to-violet-900/20 dark:border-violet-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Coverage</span>
            <div className="h-8 w-8 rounded-full bg-violet-200 dark:bg-violet-800 flex items-center justify-center">
              <span className="text-xs font-bold text-violet-600 dark:text-violet-400">#</span>
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-violet-700 dark:text-violet-300">
            {departments.filter(d => rowTotal(d.id) > 0).length} / {departments.length}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">services with forecast</p>
        </div>
      </div>

      {/* Quick Fill Panel */}
      {showQuickFill && (
        <Card className="border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <Zap className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="text-sm font-medium whitespace-nowrap">Quick Fill:</span>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[180px]"
                value={quickFillDept}
                onChange={(e) => setQuickFillDept(e.target.value)}
              >
                <option value="">Select service...</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <Input
                type="number"
                placeholder="Annual amount"
                className="h-9 w-[160px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                value={quickFillAmount}
                onChange={(e) => setQuickFillAmount(e.target.value)}
              />
              <Button size="sm" onClick={applyQuickFill} disabled={!quickFillDept || !quickFillAmount}>
                Distribute ÷12
              </Button>
              <span className="text-xs text-muted-foreground">Splits evenly across all months</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts Row */}
      {total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Monthly Revenue Trend */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Monthly Revenue Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlyData} margin={{ left: 5, right: 5, top: 10 }}>
                  <defs>
                    <VBarGradient id="sf-rev-grad" color={BUDGET_COLORS.planIndigo} />
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/15" vertical={false} />
                  <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS_TICK} tickFormatter={fmtK} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(v: number) => [fmt(v) + " ₼", "Revenue"]}
                    contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))" }}
                  />
                  <Bar dataKey="revenue" fill="url(#sf-rev-grad)" radius={[4, 4, 0, 0]} animationDuration={ANIMATION.duration} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Revenue Mix Donut */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Revenue Mix</CardTitle>
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
                    dataKey="value"
                    paddingAngle={2}
                    animationDuration={ANIMATION.duration}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => [fmt(v) + " ₼"]}
                    contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))" }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center -mt-2">
                {pieData.slice(0, 6).map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[10px]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-muted-foreground truncate max-w-[80px]">{d.name}</span>
                    <span className="font-mono text-foreground">{total > 0 ? Math.round(d.value / total * 100) : 0}%</span>
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
              {year} — {departments.length} services
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {showVat ? "Amounts incl. VAT 18%" : "Amounts excl. VAT (net)"}
            </span>
          </div>
        </CardHeader>
        {showTable && (
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-2 border font-medium sticky left-0 bg-muted/50 min-w-[140px] z-10">
                      Service
                    </th>
                    {MONTHS.map((m, i) => (
                      <th key={i} className="text-right p-2 border font-medium min-w-[95px]">
                        {m}
                      </th>
                    ))}
                    <th className="text-right p-2 border font-semibold min-w-[110px] bg-blue-50 dark:bg-blue-950">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((dept) => (
                    <tr key={dept.id} className="hover:bg-muted/30">
                      <td className="p-2 border font-medium sticky left-0 bg-background z-10">
                        {dept.label}
                      </td>
                      {MONTHS.map((_, mi) => {
                        const month = mi + 1
                        const displayVal = getVal(dept.id, month)
                        return (
                          <td key={mi} className="p-1 border">
                            <Input
                              type="number"
                              className="h-8 text-right text-xs tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              value={displayVal ? Math.round(displayVal) : ""}
                              placeholder="0"
                              onChange={(e) => setCell(dept.id, month, Number(e.target.value) || 0)}
                            />
                          </td>
                        )
                      })}
                      <td className="p-2 border text-right font-semibold tabular-nums bg-blue-50 dark:bg-blue-950">
                        {fmt(rowTotal(dept.id))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {/* VAT row */}
                  <tr className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-xs">
                    <td className="p-2 border sticky left-0 bg-amber-50 dark:bg-amber-950/30 z-10 font-medium">
                      VAT (18%)
                    </td>
                    {MONTHS.map((_, mi) => (
                      <td key={mi} className="p-2 border text-right tabular-nums">
                        {fmt(colVat(mi + 1))}
                      </td>
                    ))}
                    <td className="p-2 border text-right tabular-nums font-medium bg-amber-100 dark:bg-amber-900/30">
                      {fmt(grandVat())}
                    </td>
                  </tr>
                  {/* Total row */}
                  <tr className="bg-muted/70 font-semibold">
                    <td className="p-2 border sticky left-0 bg-muted/70 z-10">
                      TOTAL {showVat ? "(incl. VAT)" : "(excl. VAT)"}
                    </td>
                    {MONTHS.map((_, mi) => (
                      <td key={mi} className="p-2 border text-right tabular-nums">
                        {fmt(colTotal(mi + 1))}
                      </td>
                    ))}
                    <td className="p-2 border text-right tabular-nums bg-blue-100 dark:bg-blue-900">
                      {fmt(grandTotal())}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
