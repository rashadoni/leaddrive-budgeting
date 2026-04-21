"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  BarChart3, Table2, PieChart, LineChart, AreaChart, Save, Download,
  FolderOpen, Plus, Trash2, X, Layers, ChevronRight, Layers3,
} from "lucide-react"
import {
  BarChart, Bar, LineChart as RLineChart, Line, PieChart as RPieChart, Pie,
  AreaChart as RAreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AnimatedNumber, fmtManat } from "@/components/animated-number"
import { BUDGET_COLORS, ANIMATION, AXIS_TICK, fmtK, VBarGradient } from "@/lib/budget-chart-theme"
import {
  useBudgetPlans,
  useSavedBudgetReports,
  useCreateBudgetReport,
  useDeleteBudgetReport,
  useBudgetReportPreview,
  useBudgetReportExport,
  useReportEntities,
} from "@/lib/budgeting/hooks"
import type { BudgetReportConfig } from "@/lib/budgeting/report-engine"

const CHART_TYPES = [
  { value: "table", icon: Table2, label: "Table" },
  { value: "bar", icon: BarChart3, label: "Bar" },
  { value: "stacked_bar", icon: Layers3, label: "Stacked" },
  { value: "line", icon: LineChart, label: "Line" },
  { value: "pie", icon: PieChart, label: "Pie" },
  { value: "area", icon: AreaChart, label: "Area" },
]

const FILTER_OPS = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
  { value: "contains", label: "Contains" },
]

const PERIOD_GROUP_OPTIONS = [
  { value: "none", label: "None" },
  { value: "month", label: "Monthly" },
  { value: "quarter", label: "Quarterly" },
  { value: "year", label: "Yearly" },
]

const COMPUTED_FIELD_OPTIONS = [
  { value: "variance", label: "Variance (Plan - Actual)" },
  { value: "execution_pct", label: "Execution %" },
  { value: "margin_pct", label: "Margin %" },
]

type FilterItem = { field: string; op: string; value: string }

export default function ReportBuilderPage() {
  const t = useTranslations("reportBuilder")
  const router = useRouter()
  const searchParams = useSearchParams()
  const reportIdParam = searchParams.get("reportId")

  const plans = useBudgetPlans()
  const entities = useReportEntities()
  const savedReports = useSavedBudgetReports()
  const createReport = useCreateBudgetReport()
  const deleteReport = useDeleteBudgetReport()
  const exportReport = useBudgetReportExport()

  // Config state
  const [planId, setPlanId] = useState<string>("")
  const [entityType, setEntityType] = useState<string>("")
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const [filters, setFilters] = useState<FilterItem[]>([])
  const [groupBy, setGroupBy] = useState<string>("")
  const [periodGroupBy, setPeriodGroupBy] = useState<string>("none")
  const [sortBy, setSortBy] = useState<string>("")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [chartType, setChartType] = useState<string>("table")
  const [computedFields, setComputedFields] = useState<string[]>([])
  const [limit, setLimit] = useState(100)
  const [loadedReportName, setLoadedReportName] = useState<string>("")

  // Dialog state
  const [saveOpen, setSaveOpen] = useState(false)
  const [loadOpen, setLoadOpen] = useState(false)
  const [reportName, setReportName] = useState("")

  // Deep linking: auto-load report from ?reportId=xxx
  const [deepLinkLoaded, setDeepLinkLoaded] = useState(false)
  useEffect(() => {
    if (reportIdParam && savedReports.data && !deepLinkLoaded) {
      const report = savedReports.data.find((r: any) => r.id === reportIdParam)
      if (report) {
        setEntityType(report.entityType)
        setPlanId((report as any).planId ?? "")
        setSelectedColumns((report as any).columns?.map((c: any) => c.field) ?? [])
        setFilters((report as any).filters ?? [])
        setGroupBy((report as any).groupBy ?? "")
        setPeriodGroupBy((report as any).periodGroupBy ?? "none")
        setSortBy((report as any).sortBy ?? "")
        setSortOrder((report as any).sortOrder ?? "desc")
        setChartType((report as any).chartType ?? "table")
        setComputedFields((report as any).computedFields ?? [])
        setLoadedReportName(report.name)
        setDeepLinkLoaded(true)
      }
    }
  }, [reportIdParam, savedReports.data, deepLinkLoaded])

  // Current entity config
  const currentEntity = useMemo(
    () => entities.data?.find(e => e.key === entityType),
    [entities.data, entityType],
  )

  // Build preview config
  const previewConfig = useMemo<BudgetReportConfig | null>(() => {
    if (!entityType || selectedColumns.length === 0) return null
    return {
      entityType,
      planId: planId || undefined,
      columns: selectedColumns.map(f => ({ field: f })),
      filters: filters.filter(f => f.field && f.value).map(f => ({
        field: f.field,
        op: f.op,
        value: isNaN(Number(f.value)) ? f.value : Number(f.value),
      })),
      groupBy: groupBy || undefined,
      periodGroupBy: periodGroupBy !== "none" ? periodGroupBy as any : undefined,
      sortBy: sortBy || undefined,
      sortOrder,
      computedFields: computedFields.length > 0 ? computedFields : undefined,
      limit,
    }
  }, [entityType, planId, selectedColumns, filters, groupBy, periodGroupBy, sortBy, sortOrder, computedFields, limit])

  const preview = useBudgetReportPreview(previewConfig)

  // Narrowing helpers — declared here so every useMemo below can read them
  // without triggering a TDZ error. `preview.data` is optionally chained in
  // case the hook hasn't resolved yet.
  const previewRows = preview.data?.data as any[] | undefined
  const previewTotal = preview.data?.total as number | undefined
  const hasRows = Boolean(previewRows && previewRows.length > 0)

  // Handlers
  const handleEntityChange = useCallback((val: string) => {
    setEntityType(val)
    setSelectedColumns([])
    setFilters([])
    setGroupBy("")
    setPeriodGroupBy("none")
    setSortBy("")
    setComputedFields([])
  }, [])

  const toggleColumn = useCallback((field: string) => {
    setSelectedColumns(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field],
    )
  }, [])

  const addFilter = useCallback(() => {
    setFilters(prev => [...prev, { field: "", op: "eq", value: "" }])
  }, [])

  const removeFilter = useCallback((idx: number) => {
    setFilters(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const updateFilter = useCallback((idx: number, key: keyof FilterItem, val: string) => {
    setFilters(prev => prev.map((f, i) => i === idx ? { ...f, [key]: val } : f))
  }, [])

  const handleSave = useCallback(async () => {
    if (!reportName || !previewConfig) return
    await createReport.mutateAsync({
      name: reportName,
      entityType: previewConfig.entityType,
      planId: previewConfig.planId ?? null,
      columns: previewConfig.columns,
      filters: previewConfig.filters,
      groupBy: previewConfig.groupBy ?? null,
      periodGroupBy: (previewConfig.periodGroupBy as any) ?? null,
      sortBy: previewConfig.sortBy ?? null,
      sortOrder: previewConfig.sortOrder ?? "desc",
      chartType,
      computedFields: previewConfig.computedFields ?? null,
      isShared: false,
      createdBy: null,
      chartConfig: null,
      description: null,
    })
    setSaveOpen(false)
    setReportName("")
  }, [reportName, previewConfig, chartType, createReport])

  const handleLoad = useCallback((report: any) => {
    setEntityType(report.entityType)
    setPlanId(report.planId ?? "")
    setSelectedColumns(report.columns?.map((c: any) => c.field) ?? [])
    setFilters(report.filters ?? [])
    setGroupBy(report.groupBy ?? "")
    setPeriodGroupBy(report.periodGroupBy ?? "none")
    setSortBy(report.sortBy ?? "")
    setSortOrder(report.sortOrder ?? "desc")
    setChartType(report.chartType ?? "table")
    setComputedFields(report.computedFields ?? [])
    setLoadedReportName(report.name)
    setLoadOpen(false)
    // Update URL with deep link
    router.replace(`/budgeting/reports?reportId=${report.id}`, { scroll: false })
  }, [router])

  const handleExport = useCallback((format: "csv" | "xlsx") => {
    if (!previewConfig) return
    exportReport.mutate({ ...previewConfig, format })
  }, [previewConfig, exportReport])

  // Compute KPI from preview data
  const kpis = useMemo(() => {
    if (!preview.data?.data?.length) return null
    const rows = (previewRows ?? [])
    let totalPlanned = 0, totalActual = 0, totalAmount = 0
    for (const r of rows) {
      totalPlanned += r.plannedAmount ?? r.amount ?? r.forecastAmount ?? r.totalCost ?? 0
      totalActual += r.actualAmount ?? 0
      totalAmount += r.amount ?? r.forecastAmount ?? r.totalCost ?? r.plannedAmount ?? 0
    }
    const variance = totalPlanned - totalActual
    const executionPct = totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0
    return { totalPlanned, totalActual, totalAmount, variance, executionPct, count: rows.length }
  }, [preview.data])

  // Numeric columns for charts — derive from actual data when grouped/period
  const numericColumns = useMemo(() => {
    if (!currentEntity) return []
    const rows = preview.data?.data
    const dataType = preview.data?.type

    // For grouped or period data, detect numeric keys from actual response rows
    if ((dataType === "grouped" || dataType === "period") && rows && rows.length > 0) {
      const sample = rows[0]
      const exclude = new Set(["_count", "_sum", "year", "month", "quarter", "period", "id"])
      // Include the groupBy field in exclude since it's the label, not a value
      if (groupBy) exclude.add(groupBy)
      return Object.keys(sample).filter(k => !exclude.has(k) && typeof sample[k] === "number")
    }

    // Flat data — use selected numeric columns from entity definition
    const excludeWhenPeriod = periodGroupBy !== "none" ? ["year", "month"] : []
    return currentEntity.fields
      .filter(f => f.type === "number" && selectedColumns.includes(f.name) && !excludeWhenPeriod.includes(f.name))
      .map(f => f.name)
  }, [currentEntity, selectedColumns, periodGroupBy, groupBy, preview.data])

  // Label column for charts
  const labelColumn = useMemo(() => {
    const dataType = preview.data?.type
    const rows = preview.data?.data

    // Period data always has "period" key
    if (dataType === "period" && rows && rows.length > 0 && "period" in rows[0]) return "period"

    // Period groupBy set but entity doesn't support it — fall through to groupBy or string col
    if (periodGroupBy !== "none" && dataType !== "period") {
      if (groupBy) return groupBy
    } else if (periodGroupBy !== "none") {
      return "period"
    }

    // GroupBy uses the grouped field
    if (groupBy) return groupBy
    if (!currentEntity) return "id"
    const strCols = currentEntity.fields
      .filter(f => f.type === "string" && selectedColumns.includes(f.name))
    return strCols[0]?.name ?? "id"
  }, [currentEntity, selectedColumns, periodGroupBy, groupBy, preview.data])

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* ─── Left Sidebar: Config ─── */}
      <div className="w-[340px] shrink-0 border-r bg-card overflow-y-auto p-4 space-y-5">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          {t("title")}
        </h2>

        {/* Plan Selector */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("plan")}</Label>
          <select
            className="flex h-8 w-full rounded-lg border border-border/70 bg-card px-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            value={planId}
            onChange={e => setPlanId(e.target.value)}
          >
            <option value="">{t("allPlans")}</option>
            {plans.data?.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Entity Selector */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("entity")}</Label>
          <select
            className="flex h-8 w-full rounded-lg border border-border/70 bg-card px-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            value={entityType}
            onChange={e => handleEntityChange(e.target.value)}
          >
            <option value="">{t("selectEntity")}</option>
            {entities.data?.map(e => (
              <option key={e.key} value={e.key}>{t(`entities.${e.key}`)}</option>
            ))}
          </select>
        </div>

        {/* Column Picker */}
        {currentEntity && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("columns")}</Label>
            <div className="max-h-44 overflow-y-auto rounded-md border p-2 space-y-1">
              {currentEntity.fields.map(f => (
                <label key={f.name} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-accent rounded px-1 py-0.5">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded accent-primary"
                    checked={selectedColumns.includes(f.name)}
                    onChange={() => toggleColumn(f.name)}
                  />
                  <span>{f.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{f.type}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Period Grouping */}
        {currentEntity?.hasYearMonth && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("periodGroup")}</Label>
            <div className="flex gap-1">
              {PERIOD_GROUP_OPTIONS.map(o => (
                <Button
                  key={o.value}
                  size="sm"
                  variant={periodGroupBy === o.value ? "default" : "outline"}
                  className="h-7 text-xs flex-1"
                  onClick={() => setPeriodGroupBy(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Group By */}
        {currentEntity && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("groupBy")}</Label>
            <select
              className="flex h-8 w-full rounded-lg border border-border/70 bg-card px-2 text-xs"
              value={groupBy}
              onChange={e => setGroupBy(e.target.value)}
            >
              <option value="">{t("noGrouping")}</option>
              {currentEntity.fields.filter(f => f.type === "string").map(f => (
                <option key={f.name} value={f.name}>{f.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Computed Fields */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("computed")}</Label>
          <div className="space-y-1">
            {COMPUTED_FIELD_OPTIONS.map(cf => (
              <label key={cf.value} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded accent-primary"
                  checked={computedFields.includes(cf.value)}
                  onChange={() =>
                    setComputedFields(prev =>
                      prev.includes(cf.value)
                        ? prev.filter(v => v !== cf.value)
                        : [...prev, cf.value],
                    )
                  }
                />
                <span>{cf.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t("filters")}</Label>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={addFilter}>
              <Plus className="h-3 w-3 mr-1" />{t("addFilter")}
            </Button>
          </div>
          {filters.map((f, idx) => (
            <div key={idx} className="flex gap-1 items-center">
              <select
                className="h-7 flex-1 rounded border border-border/70 bg-card px-1 text-[11px]"
                value={f.field}
                onChange={e => updateFilter(idx, "field", e.target.value)}
              >
                <option value="">Field</option>
                {currentEntity?.fields.map(fd => (
                  <option key={fd.name} value={fd.name}>{fd.label}</option>
                ))}
              </select>
              <select
                className="h-7 w-14 rounded border border-border/70 bg-card px-1 text-[11px]"
                value={f.op}
                onChange={e => updateFilter(idx, "op", e.target.value)}
              >
                {FILTER_OPS.map(op => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
              <Input
                className="h-7 text-[11px] flex-1"
                value={f.value}
                onChange={e => updateFilter(idx, "value", e.target.value)}
                placeholder="Value"
              />
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeFilter(idx)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        {/* Sort */}
        {currentEntity && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("sortBy")}</Label>
            <div className="flex gap-1">
              <select
                className="h-8 flex-1 rounded-lg border border-border/70 bg-card px-2 text-xs"
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
              >
                <option value="">{t("noSort")}</option>
                {currentEntity.fields.map(f => (
                  <option key={f.name} value={f.name}>{f.label}</option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs w-14"
                onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
              >
                {sortOrder === "asc" ? "A→Z" : "Z→A"}
              </Button>
            </div>
          </div>
        )}

        {/* Chart Type */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("chartType")}</Label>
          <div className="flex gap-1">
            {CHART_TYPES.map(ct => (
              <Button
                key={ct.value}
                size="sm"
                variant={chartType === ct.value ? "default" : "outline"}
                className="h-8 flex-1 text-xs"
                onClick={() => setChartType(ct.value)}
                title={ct.label}
              >
                <ct.icon className="h-3.5 w-3.5" />
              </Button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2 border-t">
          <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => setLoadOpen(true)}>
            <FolderOpen className="h-3.5 w-3.5 mr-1" />{t("load")}
          </Button>
          <Button size="sm" className="flex-1 text-xs" onClick={() => setSaveOpen(true)} disabled={!previewConfig}>
            <Save className="h-3.5 w-3.5 mr-1" />{t("save")}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => handleExport("csv")} disabled={!previewConfig}>
            <Download className="h-3.5 w-3.5 mr-1" />CSV
          </Button>
          <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => handleExport("xlsx")} disabled={!previewConfig}>
            <Download className="h-3.5 w-3.5 mr-1" />XLSX
          </Button>
        </div>
      </div>

      {/* ─── Right Panel: Preview ─── */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/budgeting" className="hover:text-foreground transition-colors">{t("breadcrumbBudgeting")}</Link>
          <ChevronRight className="h-3 w-3" />
          <span className={loadedReportName ? "hover:text-foreground cursor-pointer" : "text-foreground font-medium"}>
            {t("title")}
          </span>
          {loadedReportName && (
            <>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground font-medium">{loadedReportName}</span>
            </>
          )}
        </nav>

        {!entityType && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Layers className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-lg font-medium">{t("emptyTitle")}</p>
            <p className="text-sm">{t("emptyDesc")}</p>
          </div>
        )}

        {entityType && selectedColumns.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p className="text-sm">{t("selectColumns")}</p>
          </div>
        )}

        {/* KPI Summary */}
        {kpis && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 border-indigo-500/20">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{t("totalAmount")}</p>
                <p className="text-xl font-bold text-indigo-500">
                  <AnimatedNumber value={kpis.totalAmount} formatter={fmtManat} />
                </p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/20">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{t("totalActual")}</p>
                <p className="text-xl font-bold text-emerald-500">
                  <AnimatedNumber value={kpis.totalActual} formatter={fmtManat} />
                </p>
              </CardContent>
            </Card>
            <Card className={`bg-gradient-to-br ${kpis.variance >= 0 ? "from-green-500/10 to-green-500/5 border-green-500/20" : "from-red-500/10 to-red-500/5 border-red-500/20"}`}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{t("variance")}</p>
                <p className={`text-xl font-bold ${kpis.variance >= 0 ? "text-green-500" : "text-red-500"}`}>
                  <AnimatedNumber value={kpis.variance} formatter={fmtManat} />
                </p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-violet-500/10 to-violet-500/5 border-violet-500/20">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{t("execution")}</p>
                <p className="text-xl font-bold text-violet-500">
                  <AnimatedNumber value={kpis.executionPct} formatter={v => `${v.toFixed(1)}%`} />
                </p>
                <div className="mt-2 h-1.5 w-full rounded-full bg-violet-500/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-violet-500 transition-all duration-700"
                    style={{ width: `${Math.min(kpis.executionPct, 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-amber-500/20">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{t("rows")}</p>
                <p className="text-xl font-bold text-amber-500">
                  <AnimatedNumber value={kpis.count} formatter={v => String(v)} />
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Chart */}
        {hasRows && chartType !== "table" && numericColumns.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <ResponsiveContainer width="100%" height={350}>
                {chartType === "bar" ? (
                  <BarChart data={(previewRows ?? [])}>
                    <defs>
                      {numericColumns.map((col, i) => (
                        <VBarGradient key={col} id={`grad-${col}`} color={BUDGET_COLORS.pie[i % BUDGET_COLORS.pie.length]} />
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" />
                    <XAxis dataKey={labelColumn} tick={AXIS_TICK} />
                    <YAxis tickFormatter={fmtK} tick={AXIS_TICK} />
                    <Tooltip formatter={((v: number) => fmtManat(v)) as never} />
                    <Legend />
                    {numericColumns.map((col, i) => (
                      <Bar
                        key={col}
                        dataKey={col}
                        fill={`url(#grad-${col})`}
                        animationDuration={ANIMATION.duration}
                        radius={[4, 4, 0, 0]}
                      />
                    ))}
                  </BarChart>
                ) : chartType === "stacked_bar" ? (
                  <BarChart data={(previewRows ?? [])}>
                    <defs>
                      {numericColumns.map((col, i) => (
                        <VBarGradient key={col} id={`grad-stk-${col}`} color={BUDGET_COLORS.pie[i % BUDGET_COLORS.pie.length]} />
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" />
                    <XAxis dataKey={labelColumn} tick={AXIS_TICK} />
                    <YAxis tickFormatter={fmtK} tick={AXIS_TICK} />
                    <Tooltip formatter={((v: number) => fmtManat(v)) as never} />
                    <Legend />
                    {numericColumns.map((col, i) => (
                      <Bar
                        key={col}
                        dataKey={col}
                        stackId="stack"
                        fill={`url(#grad-stk-${col})`}
                        animationDuration={ANIMATION.duration}
                      />
                    ))}
                  </BarChart>
                ) : chartType === "line" ? (
                  <RLineChart data={(previewRows ?? [])}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" />
                    <XAxis dataKey={labelColumn} tick={AXIS_TICK} />
                    <YAxis tickFormatter={fmtK} tick={AXIS_TICK} />
                    <Tooltip formatter={((v: number) => fmtManat(v)) as never} />
                    <Legend />
                    {numericColumns.map((col, i) => (
                      <Line
                        key={col}
                        type="monotone"
                        dataKey={col}
                        stroke={BUDGET_COLORS.pie[i % BUDGET_COLORS.pie.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        animationDuration={ANIMATION.duration}
                      />
                    ))}
                  </RLineChart>
                ) : chartType === "area" ? (
                  <RAreaChart data={(previewRows ?? [])}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted-foreground/20" />
                    <XAxis dataKey={labelColumn} tick={AXIS_TICK} />
                    <YAxis tickFormatter={fmtK} tick={AXIS_TICK} />
                    <Tooltip formatter={((v: number) => fmtManat(v)) as never} />
                    <Legend />
                    {numericColumns.map((col, i) => (
                      <Area
                        key={col}
                        type="monotone"
                        dataKey={col}
                        fill={BUDGET_COLORS.pie[i % BUDGET_COLORS.pie.length]}
                        fillOpacity={0.2}
                        stroke={BUDGET_COLORS.pie[i % BUDGET_COLORS.pie.length]}
                        animationDuration={ANIMATION.duration}
                      />
                    ))}
                  </RAreaChart>
                ) : (
                  <RPieChart>
                    <Pie
                      data={(previewRows ?? []).slice(0, 10).map((r: any, i: number) => ({
                        name: r[labelColumn] || `Item ${i + 1}`,
                        value: r[numericColumns[0]] ?? 0,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={120}
                      animationDuration={ANIMATION.duration}
                      label={({ name, percent }: any) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    >
                      {(previewRows ?? []).slice(0, 10).map((_: any, i: number) => (
                        <Cell key={i} fill={BUDGET_COLORS.pie[i % BUDGET_COLORS.pie.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={((v: number) => fmtManat(v)) as never} />
                    <Legend />
                  </RPieChart>
                )}
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Data Table */}
        {hasRows && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("dataPreview")} ({(previewTotal ?? 0)} {t("rows")})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {selectedColumns.map(col => (
                        <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                          {currentEntity?.fields.find(f => f.name === col)?.label ?? col}
                        </th>
                      ))}
                      {computedFields.map(cf => (
                        <th key={cf} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                          {COMPUTED_FIELD_OPTIONS.find(o => o.value === cf)?.label ?? cf}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(previewRows ?? []).map((row: any, i: number) => (
                      <tr key={i} className="border-b hover:bg-muted/30">
                        {selectedColumns.map(col => {
                          const fd = currentEntity?.fields.find(f => f.name === col)
                          const val = col.includes(".") ? col.split(".").reduce((o: any, k: string) => o?.[k], row) : row[col]
                          return (
                            <td key={col} className={`px-3 py-1.5 whitespace-nowrap ${fd?.type === "number" ? "text-right font-mono" : ""}`}>
                              {fd?.type === "number" && typeof val === "number" ? fmtManat(val) : String(val ?? "")}
                            </td>
                          )
                        })}
                        {computedFields.map(cf => (
                          <td key={cf} className="px-3 py-1.5 text-right font-mono whitespace-nowrap">
                            {cf === "execution_pct" || cf === "margin_pct"
                              ? `${(row[cf] ?? 0).toFixed(1)}%`
                              : typeof row[cf] === "number" ? fmtManat(row[cf]) : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {preview.isLoading && (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            <span className="ml-2 text-sm">{t("loading")}</span>
          </div>
        )}

        {preview.isError && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="p-4 text-sm text-red-500">
              {preview.error?.message}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ─── Save Dialog ─── */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("saveReport")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("reportName")}</Label>
              <Input value={reportName} onChange={e => setReportName(e.target.value)} placeholder={t("reportNamePlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleSave} disabled={!reportName || createReport.isPending}>
              {createReport.isPending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Load Dialog ─── */}
      <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("loadReport")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {savedReports.data?.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("noSavedReports")}</p>
            )}
            {savedReports.data?.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border p-3 hover:bg-accent">
                <button className="text-left flex-1" onClick={() => handleLoad(r)}>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{r.entityType} &middot; {new Date(r.updatedAt).toLocaleDateString()}</p>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-red-500"
                  onClick={() => deleteReport.mutate(r.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadOpen(false)}>{t("cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
