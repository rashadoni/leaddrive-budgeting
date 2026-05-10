// WorkspaceTab — extracted from `src/app/(dashboard)/budgeting/page.tsx`
// Turn LXXXVIII (Phase 3.1 final tab extraction; biggest god-component
// split: ~1232 LOC + ~70 LOC ApplyTemplatesButton private helper).
//
// Pure refactor — zero functional change. Includes ApplyTemplatesButton
// (sole consumer was WorkspaceTab) as private helper.
//
// Closure-leak risk: NONE — all hooks/components are leaf imports;
// no parent state captured.
"use client"

import React, { useState, useMemo, useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  Pencil, Plus, Trash2, AlertCircle, Banknote, BarChart2, CheckCircle,
  ChevronDown, ChevronRight, DollarSign, LayoutGrid, Link2, List, Loader2,
  MessageSquare, TrendingDown, TrendingUp,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { AnimatedNumber } from "@/components/animated-number"
import { fmtK } from "@/lib/budget-chart-theme"
import { BudgetCategoryBars } from "@/components/budget-category-bars"
import { BudgetChangeHistory } from "@/components/budget-change-history"
import { BudgetExecutionGauge } from "@/components/budget-execution-gauge"
import { BudgetFxSummary } from "@/components/budget-fx-summary"
import { BudgetMatrixGrid } from "@/components/budget-matrix-grid"
import { BudgetWaterfallChart } from "@/components/budget-waterfall-chart"
import { InfoHint } from "@/components/info-hint"
import {
  useBudgetActuals, useBudgetAnalytics, useBudgetLines, useBudgetTemplates,
  useApplyTemplates, useCreateBudgetActual, useCreateBudgetLine,
  useDeleteBudgetActual, useDeleteBudgetLine, useSyncActuals, useUpdateBudgetLine,
} from "@/lib/budgeting/hooks"
import { type BudgetLine, type BudgetDirectionTemplate } from "@/lib/budgeting/types"
import { computeOperatingProfit } from "@/lib/budgeting/operating-profit"
import { varPct } from "@/lib/budgeting/var-pct"
import { toast } from "sonner"

// Local fmt helper — duplicated from page.tsx::fmt (CARRYOVER M6 dedup
// deferred until last consumer extracted; this is the last-but-one).
function fmt(n: number): string {
  return Math.round(n).toLocaleString() + " ₼"
}

// ApplyTemplatesButton — moved into WorkspaceTab.tsx as private helper
// (Turn LXXXVIII; was inline in page.tsx, sole consumer is WorkspaceTab).
function ApplyTemplatesButton({ planId }: { planId: string }) {
  const t = useTranslations("budgeting")
  const { data: templates = [] } = useBudgetTemplates()
  const applyTemplates = useApplyTemplates()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)

  const activeTemplates = templates.filter((tpl: BudgetDirectionTemplate) => tpl.isActive)

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleApply = async () => {
    if (selected.size === 0) return
    const res = await applyTemplates.mutateAsync({ planId, templateIds: Array.from(selected) })
    setResult(res)
    setTimeout(() => { setOpen(false); setResult(null); setSelected(new Set()) }, 2000)
  }

  if (activeTemplates.length === 0) return null

  return (
    <>
      <Button size="sm" variant="outline" title={t("hintTemplateApply")} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> {t("btnApplyTemplates")}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-sm">{t("selectTemplates")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result ? (
                <div className="flex items-center gap-2 text-sm text-[#065f46] dark:text-[#6ee7b7]">
                  <CheckCircle className="h-4 w-4" />
                  {t("templateApplied", { created: result.created, skipped: result.skipped })}
                </div>
              ) : (
                <>
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {activeTemplates.map((tpl: BudgetDirectionTemplate) => (
                      <label key={tpl.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/40 cursor-pointer text-xs">
                        <input type="checkbox" checked={selected.has(tpl.id)} onChange={() => toggle(tpl.id)} className="rounded" />
                        <span className="flex-1">{tpl.name}</span>
                        <Badge variant="outline" className="text-[10px]">{tpl.lineType}</Badge>
                        <span className="font-mono text-muted-foreground">{fmt(tpl.defaultAmount)}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={handleApply} disabled={selected.size === 0 || applyTemplates.isPending} className="flex-1">
                      {applyTemplates.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("btnApplyTemplates")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setOpen(false); setSelected(new Set()) }} className="flex-1">{t("btnCancel")}</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

export function WorkspaceTab({ planId, companyId, onNavigateTab }: { planId: string; companyId?: string | null; onNavigateTab?: (tab: string) => void }) {
  const t = useTranslations("budgeting")
  const { data: analytics, isLoading: analyticsLoading } = useBudgetAnalytics(planId, companyId)
  const { data: lines = [], isLoading: linesLoading } = useBudgetLines(planId)
  const { data: actuals = [] } = useBudgetActuals(planId)

  const updateLine = useUpdateBudgetLine()
  const createLine = useCreateBudgetLine()
  const deleteLine = useDeleteBudgetLine()
  const createActual = useCreateBudgetActual()
  const deleteActual = useDeleteBudgetActual()
  const syncActuals = useSyncActuals()
  // Edit state
  const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null)
  const [editValue, setEditValue] = useState("")
  const [expandId, setExpandId] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set(["revenue", "cogs", "expense"]))
  const toggleSection = (key: string) => setCollapsedSections(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })
  const [addingSubItem, setAddingSubItem] = useState<string | null>(null)
  const [newSubItem, setNewSubItem] = useState({ category: "", amount: "", department: "" })
  const [addingSection, setAddingSection] = useState<string | null>(null) // "revenue" | "cogs" | "expense" | null
  const [addMode, setAddMode] = useState<"line" | "toGroup" | "newGroup">("line")
  const [newRow, setNewRow] = useState({ category: "", lineType: "expense", plannedAmount: "", forecastAmount: "", department: "", parentId: "" })
  const [filterText, setFilterText] = useState("")
  const [filterType, setFilterType] = useState<"all" | "expense" | "revenue">("all")
  const [showMaterialOnly, setShowMaterialOnly] = useState(false)
  const [materialityPct, setMaterialityPct] = useState(5)
  const [materialityAbs, setMaterialityAbs] = useState(500)
  // Drill-down sheet for fact values
  const [drillDownLine, setDrillDownLine] = useState<BudgetLine | null>(null)
  // Variance note dialog
  const [varianceNoteLine, setVarianceNoteLine] = useState<BudgetLine | null>(null)
  const [varianceNoteText, setVarianceNoteText] = useState("")

  // Number format toggle — shadows outer fmt() within WorkspaceTab
  const [compactNumbers, setCompactNumbers] = useState(false)
  // List/Matrix view mode
  const [workspaceView, setWorkspaceView] = useState<"list" | "matrix">("list")
  const fmt = compactNumbers ? (n: number) => fmtK(n) + " ₼" : (n: number) => Math.round(n).toLocaleString() + " ₼"

  // New actual form for expand
  const [newActual, setNewActual] = useState({ amount: "", description: "", date: "" })

  // Build actuals by category+lineType map
  const actualsByCat = useMemo(() => {
    const m = new Map<string, { total: number; items: typeof actuals }>()
    for (const a of actuals) {
      const key = `${a.category}||${a.lineType}`
      const existing = m.get(key) ?? { total: 0, items: [] }
      existing.total += a.actualAmount
      existing.items.push(a)
      m.set(key, existing)
    }
    return m
  }, [actuals])

  // Auto-actual values from analytics
  const autoActualMap = useMemo(() => {
    const m = new Map<string, number>()
    if (analytics?.byCategory) {
      for (const c of analytics.byCategory) {
        // If the line has auto-actual, the analytics already resolved it
        m.set(c.category, c.actual)
      }
    }
    return m
  }, [analytics])

  // Filter and group lines
  const filteredLines = useMemo(() => {
    let result = [...lines]
    if (filterText) result = result.filter((l: BudgetLine) => l.category.toLowerCase().includes(filterText.toLowerCase()))
    if (filterType !== "all") result = result.filter((l: BudgetLine) => l.lineType === filterType)
    return result
  }, [lines, filterText, filterType, autoActualMap, actualsByCat])

  // Materiality check helper — used for opacity in table rows
  const isMaterial = (l: BudgetLine): boolean => {
    const factValue = l.isAutoActual ? (autoActualMap.get(l.category) ?? 0) : (actualsByCat.get(`${l.category}||${l.lineType}`)?.total ?? 0)
    const varianceAbsVal = Math.abs(l.plannedAmount - factValue)
    const variancePctVal = l.plannedAmount > 0 ? (varianceAbsVal / l.plannedAmount) * 100 : 0
    return variancePctVal >= materialityPct || varianceAbsVal >= materialityAbs
  }

  // Exclude parent-aggregate rows so totals don't double-count. Same filter as
  // the Workspace analytics endpoint. Without this, a P&L with both 601-01
  // (parent total) and 601-01-02 (child line) would count every revenue twice.
  const allLineCodes = useMemo(() => {
    const s = new Set<string>()
    for (const l of filteredLines) {
      const code = (l as any).account?.code ?? l.department ?? ""
      if (code) s.add(code)
    }
    return s
  }, [filteredLines])
  const isParentCode = useCallback((code: string): boolean => {
    for (const c of allLineCodes) {
      if (c !== code && c.startsWith(code + "-")) return true
    }
    return false
  }, [allLineCodes])
  const isLeafLine = useCallback((l: BudgetLine): boolean => {
    const code = (l as any).account?.code ?? l.department ?? ""
    return !code || !isParentCode(code)
  }, [isParentCode])

  const expenseLines = filteredLines.filter((l: BudgetLine) => l.lineType === "expense" && isLeafLine(l))
  const revenueLines = filteredLines.filter((l: BudgetLine) => l.lineType === "revenue" && isLeafLine(l))
  const cogsLines = filteredLines.filter((l: BudgetLine) => l.lineType === "cogs" && isLeafLine(l))

  // Helper: get leaf amount (children sum if group parent, else own amount)
  const leafPlanned = (l: BudgetLine) => l.children?.length ? l.children.reduce((s, c) => s + c.plannedAmount, 0) : l.plannedAmount
  const leafForecast = (l: BudgetLine) => l.children?.length ? l.children.reduce((s, c) => s + (c.forecastAmount ?? c.plannedAmount), 0) : (l.forecastAmount ?? l.plannedAmount)

  // Totals
  const totExpPlanned = expenseLines.reduce((s: number, l: BudgetLine) => s + leafPlanned(l), 0)
  const totExpForecast = expenseLines.reduce((s: number, l: BudgetLine) => s + leafForecast(l), 0)
  const totRevPlanned = revenueLines.reduce((s: number, l: BudgetLine) => s + leafPlanned(l), 0)
  const totRevForecast = revenueLines.reduce((s: number, l: BudgetLine) => s + leafForecast(l), 0)
  const totCOGSPlanned = cogsLines.reduce((s: number, l: BudgetLine) => s + leafPlanned(l), 0)
  const totCOGSForecast = cogsLines.reduce((s: number, l: BudgetLine) => s + leafForecast(l), 0)

  const { totalPlanned = 0, totalForecast = 0, totalActual = 0, totalVariance = 0, executionPct = 0, expenseExecutionPct = 0, elapsedPct = 100, autoActualTotal = 0, yearEndProjection = 0, byCategory = [], totalRevenuePlanned = 0, totalRevenueActual = 0, totalRevenueForecast = 0, totalExpensePlanned = 0, totalExpenseActual = 0, totalExpenseForecast = 0, totalCOGSPlanned = 0, totalCOGSActual = 0, totalCOGSForecast = 0, grossProfit = 0, grossProfitActual = 0, margin = 0, marginActual = 0, marginForecast = 0 } = analytics ?? {}

  // Inline edit handlers
  const startEdit = (id: string, field: string, currentVal: number) => {
    setEditCell({ id, field })
    setEditValue(String(currentVal))
  }

  const saveEdit = async () => {
    if (!editCell) return
    const val = Number(editValue)
    if (isNaN(val) || val < 0) { setEditCell(null); return }
    const { id, field } = editCell
    if (field === "plannedAmount" || field === "forecastAmount") {
      const line = lines.find((l: BudgetLine) => l.id === id)
      if (line) await updateLine.mutateAsync({ id, planId, [field]: val })
    }
    setEditCell(null)
  }

  // All parent groups filtered by adding section's lineType
  const parentGroups = lines.filter((l: BudgetLine) => l.lineType === (addingSection || "expense") && ((l.children && l.children.length > 0) || (l.notes && l.notes.startsWith("group:"))))

  // Add new row (line, sub-item in group, or new group)
  const handleAddRow = async () => {
    if (!newRow.category.trim() || !addingSection) return
    if (addMode === "newGroup") {
      await createLine.mutateAsync({
        planId,
        category: newRow.category,
        lineType: addingSection as "expense" | "revenue" | "cogs",
        plannedAmount: 0,
        notes: `group:${newRow.category.toLowerCase().replace(/\s+/g, "_")}`,
      })
    } else {
      await createLine.mutateAsync({
        planId,
        category: newRow.category,
        department: newRow.department || undefined,
        lineType: addingSection as "expense" | "revenue" | "cogs",
        plannedAmount: Number(newRow.plannedAmount) || 0,
        parentId: addMode === "toGroup" ? (newRow.parentId || undefined) : undefined,
      })
    }
    setNewRow({ category: "", lineType: "expense", plannedAmount: "", forecastAmount: "", department: "", parentId: "" })
    setAddMode("line")
    setAddingSection(null)
  }

  // Parse number: handle comma decimal separator (Excel paste) and spaces
  const parseAmount = (v: string): number => {
    const cleaned = v.replace(/\s/g, "").replace(",", ".")
    return Number(cleaned) || 0
  }

  // Add actual from expand
  const handleAddActual = async (category: string, lineType: string) => {
    if (!newActual.amount) return
    const amt = parseAmount(newActual.amount)
    if (amt <= 0) return
    await createActual.mutateAsync({
      planId,
      category,
      lineType: lineType as "expense" | "revenue" | "cogs",
      actualAmount: amt,
      description: newActual.description || undefined,
      expenseDate: newActual.date || undefined,
    })
    setNewActual({ amount: "", description: "", date: "" })
  }

  // Sync actuals
  const handleSync = async () => {
    try {
      const result = await syncActuals.mutateAsync(planId)
      toast.success(t("msgSynced", { count: result.synced }))
    } catch { toast.error(t("errorSync")) }
  }


  if (analyticsLoading || linesLoading) return (
    <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-purple-500" /></div>
  )

  // Render one grid row
  const renderRow = (line: BudgetLine) => {
    const catActuals = actualsByCat.get(`${line.category}||${line.lineType}`)
    const factValue = line.isAutoActual ? (autoActualMap.get(line.category) ?? 0) : (catActuals?.total ?? 0)
    const variance = line.lineType === "revenue" ? factValue - line.plannedAmount : line.plannedAmount - factValue
    const variancePct = line.plannedAmount > 0 ? (variance / line.plannedAmount) * 100 : 0
    const isExpanded = expandId === line.id

    const rowMaterial = !showMaterialOnly || isMaterial(line)

    return (
      <tr key={line.id} className={`border-t border-border/50 hover:bg-muted/30 group ${!rowMaterial ? "opacity-40" : ""}`}>
        {/* Category — strip cost type prefix for expenses with " — " pattern */}
        <td className="px-3 py-2 text-sm font-medium">{line.lineType === "expense" && line.category.includes(" — ") ? line.category.split(" — ").slice(1).join(" — ") : line.category}</td>
        {/* Department */}
        <td className="px-2 py-2 text-xs text-muted-foreground">{line.department || "—"}</td>
        {/* Plan - editable */}
        <td className="px-2 py-2 text-right">
          {editCell?.id === line.id && editCell?.field === "plannedAmount" ? (
            <Input type="number" className="h-7 w-24 text-right text-xs ml-auto" value={editValue} autoFocus
              onChange={e => setEditValue(e.target.value)}
              onBlur={() => saveEdit()}
              onKeyDown={e => { if (e.key === "Enter") saveEdit() }} />
          ) : (
            <button type="button" className="font-mono text-sm cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20 px-1 rounded border border-transparent hover:border-purple-300 dark:hover:border-purple-700 transition-colors"
              onClick={() => startEdit(line.id, "plannedAmount", line.plannedAmount)}>
              {fmt(line.plannedAmount)}
              <Pencil className="h-2.5 w-2.5 inline ml-1 opacity-0 group-hover:opacity-40" />
            </button>
          )}
        </td>
        {/* Fact — clickable for drill-down */}
        <td className="px-2 py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            {line.isAutoActual ? (
              <>
                <button type="button"
                  className="font-mono text-sm cursor-pointer px-1 rounded hover:underline text-primary"
                  onClick={() => setDrillDownLine(line)}
                  title={t("drillDownTitle")}>
                  {fmt(factValue)}
                </button>
                <Badge title={t("hintBadgeAuto")} className="text-[9px] bg-primary/10 text-primary px-1">{t("badgeAuto")}</Badge>
              </>
            ) : (
              <button type="button"
                className={`font-mono text-sm cursor-pointer px-1 rounded border border-transparent transition-colors hover:bg-emerald-50 hover:border-emerald-300 dark:hover:bg-emerald-900/20 dark:hover:border-emerald-700 ${
                  factValue > 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-muted-foreground"
                }`}
                onClick={() => setExpandId(isExpanded ? null : line.id)}
                title={t("wsAddActualTitle")}>
                {fmt(factValue)}
                <Pencil className="h-2.5 w-2.5 inline ml-1 opacity-0 group-hover:opacity-40" />
              </button>
            )}
          </div>
        </td>
        {/* Variance + annotation icon */}
        <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${variance >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-500"}`}>
          <div className="flex items-center justify-end gap-1">
            <button type="button"
              className={`p-0.5 rounded hover:bg-muted ${line.notes ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
              title={line.notes || t("varianceNoteTitle")}
              onClick={() => { setVarianceNoteLine(line); setVarianceNoteText(line.notes || "") }}>
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
            <span>{variance >= 0 ? "+" : ""}{variancePct.toFixed(1)}%</span>
          </div>
        </td>
        {/* Actions */}
        <td className="px-2 py-2 text-center">
          <button onClick={() => { if (confirm(t("confirmDeleteLine") + " «" + line.category + "» " + t("confirmDeleteLineSuffix"))) deleteLine.mutate({ id: line.id, planId }) }}
            title={t("hintDeleteLine")}
            className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>
    )
  }

  // Render expand detail row for actuals
  const renderExpand = (line: BudgetLine) => {
    if (expandId !== line.id || line.isAutoActual) return null
    const items = actualsByCat.get(`${line.category}||${line.lineType}`)?.items ?? []
    return (
      <tr key={`expand-${line.id}`} className="bg-muted/20">
        <td colSpan={6} className="px-4 py-2">
          <div className="text-xs space-y-1">
            <div className="font-medium text-muted-foreground mb-1">{t("actualRecordsFor")} «{line.category}»:</div>
            {items.length === 0 && <div className="text-muted-foreground italic">{t("emptyNoRecords")}</div>}
            {items.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-0.5">
                <span className="font-mono">{fmt(a.actualAmount)}</span>
                <span className="text-muted-foreground">{a.expenseDate || "—"}</span>
                <span className="text-muted-foreground flex-1">{a.description || ""}</span>
                <button onClick={() => deleteActual.mutate({ id: a.id, planId })}
                  title={t("hintDeleteLine")} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1 border-t border-border/50">
              <Input type="text" inputMode="decimal" placeholder={t("colAmount")} className="h-6 w-24 text-xs" value={newActual.amount}
                onChange={e => setNewActual(d => ({ ...d, amount: e.target.value }))} />
              <Input placeholder={t("colDescription")} className="h-6 flex-1 text-xs" value={newActual.description}
                onChange={e => setNewActual(d => ({ ...d, description: e.target.value }))} />
              <Input type="date" className="h-6 w-32 text-xs" value={newActual.date}
                onChange={e => setNewActual(d => ({ ...d, date: e.target.value }))} />
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                onClick={() => handleAddActual(line.category, line.lineType)}>
                <Plus className="h-3 w-3 mr-1" /> {t("btnAdd")}
              </Button>
            </div>
          </div>
        </td>
      </tr>
    )
  }

  // Group colors by notes tag
  const GROUP_COLORS: Record<string, string> = {
    "group:admin":      "bg-violet-500",
    "group:tech_infra": "bg-primary",
    "group:labor":      "bg-emerald-500",
    "group:risk":       "bg-amber-500",
  }

  // Add sub-item under a parent group
  const handleAddSubItem = async (parentLine: BudgetLine) => {
    if (!newSubItem.category.trim()) return
    await createLine.mutateAsync({
      planId,
      category: newSubItem.category,
      lineType: parentLine.lineType as "expense" | "revenue" | "cogs",
      plannedAmount: Number(newSubItem.amount) || 0,
      parentId: parentLine.id,
      department: newSubItem.department || undefined,
    })
    setNewSubItem({ category: "", amount: "", department: "" })
    setAddingSubItem(null)
  }

  // Render a group header row (collapsible)
  const renderGroupHeader = (line: BudgetLine) => {
    const groupTag = line.notes ?? ""
    const colorClass = GROUP_COLORS[groupTag] ?? "bg-muted-foreground/40"
    const children = line.children ?? []
    const groupTotal = children.reduce((s, c) => s + c.plannedAmount, 0)
    // If parent group has isAutoActual, use parent's auto-actual (e.g. adminOverhead, techInfraTotal)
    const groupActual = line.isAutoActual
      ? (autoActualMap.get(line.category) ?? 0)
      : children.reduce((s, c) => {
          return s + (c.isAutoActual ? (autoActualMap.get(c.category) ?? 0) : (actualsByCat.get(`${c.category}||${c.lineType}`)?.total ?? 0))
        }, 0)
    const isOpen = expandedGroups.has(groupTag.replace("group:", ""))
    const toggleGroup = () => {
      const key = groupTag.replace("group:", "")
      setExpandedGroups(prev => {
        const next = new Set(prev)
        next.has(key) ? next.delete(key) : next.add(key)
        return next
      })
    }

    return (
      <tr key={line.id} className="border-t border-border/40 bg-muted/20 hover:bg-muted/40 cursor-pointer select-none group" onClick={toggleGroup}>
        <td className="px-3 py-2.5" colSpan={2}>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorClass}`} />
            {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className="font-semibold text-sm">{line.category}</span>
            <Badge variant="outline" title={t("hintBadgeChildCount")} className="ml-1 text-[10px] px-1.5 py-0">{children.length}</Badge>
          </div>
        </td>
        <td className="px-2 py-2.5 text-right font-mono text-sm font-semibold"><AnimatedNumber value={groupTotal} duration={500} formatter={fmt} /></td>
        <td className="px-2 py-2.5 text-right font-mono text-sm font-semibold text-[#065f46] dark:text-[#6ee7b7]"><AnimatedNumber value={groupActual} duration={500} formatter={fmt} /></td>
        <td className="px-2 py-2.5 text-right text-sm font-semibold text-muted-foreground">
          {groupTotal > 0 ? `${(((groupTotal - groupActual) / groupTotal) * 100).toFixed(1)}%` : "—"}
        </td>
        <td className="px-2 py-2.5 text-center" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1 justify-center">
            <button
              className="p-1 rounded hover:bg-purple-50 dark:hover:bg-purple-900/20 text-muted-foreground hover:text-purple-600 opacity-60 hover:opacity-100"
              title={t("hintAddSubItem")}
              onClick={() => setAddingSubItem(addingSubItem === line.id ? null : line.id)}>
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
              title={t("hintDeleteLine")}
              onClick={() => {
                const childCount = children.length
                const msg = childCount > 0
                  ? `${t("confirmDeleteLine")} «${line.category}» (${childCount} subcategories will be detached)?`
                  : `${t("confirmDeleteLine")} «${line.category}»?`
                if (confirm(msg)) deleteLine.mutate({ id: line.id, planId })
              }}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  // Render a child (sub-item) row — indented
  const renderChildRow = (child: BudgetLine) => {
    const factValue = child.isAutoActual ? (autoActualMap.get(child.category) ?? 0) : (actualsByCat.get(`${child.category}||${child.lineType}`)?.total ?? 0)
    const variance = child.lineType === "revenue" ? factValue - child.plannedAmount : child.plannedAmount - factValue
    const variancePct = child.plannedAmount > 0 ? (variance / child.plannedAmount) * 100 : 0
    const isExpanded = expandId === child.id

    const noteText = child.notes && !child.notes.startsWith("group:") ? child.notes : null

    return (
      <React.Fragment key={child.id}>
        <tr className="border-t border-border/30 hover:bg-muted/20 group">
          <td className="px-3 py-1.5 text-sm" colSpan={2}>
            <div className="flex items-center gap-1 pl-6">
              <span className="text-muted-foreground text-xs">—</span>
              <span className="flex-1">{child.category}</span>
              {child.department && <Badge variant="outline" className="text-[9px] px-1">{child.department}</Badge>}
            </div>
            {noteText && <div className="pl-8 text-[10px] text-muted-foreground italic mt-0.5">{noteText}</div>}
          </td>
          <td className="px-2 py-1.5 text-right">
            {editCell?.id === child.id && editCell?.field === "plannedAmount" ? (
              <Input type="number" className="h-6 w-24 text-right text-xs ml-auto" value={editValue} autoFocus
                onChange={e => setEditValue(e.target.value)}
                onBlur={() => saveEdit()} onKeyDown={e => { if (e.key === "Enter") saveEdit() }} />
            ) : (
              <button type="button" className="font-mono text-sm cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20 px-1 rounded border border-transparent hover:border-purple-300 dark:hover:border-purple-700 transition-colors"
                onClick={() => startEdit(child.id, "plannedAmount", child.plannedAmount)}>
                {fmt(child.plannedAmount)}
                <Pencil className="h-2.5 w-2.5 inline ml-1 opacity-0 group-hover:opacity-40" />
              </button>
            )}
          </td>
          <td className="px-2 py-1.5 text-right">
            <div className="flex items-center justify-end gap-1">
              <button type="button"
                className={`font-mono text-sm cursor-pointer px-1 rounded hover:underline ${child.isAutoActual ? "text-primary" : "text-[#065f46] dark:text-[#6ee7b7]"}`}
                onClick={() => setDrillDownLine(child)}
                title={t("drillDownTitle")}>
                {fmt(factValue)}
              </button>
              {child.isAutoActual && (
                <Badge title={t("hintBadgeAuto")} className="text-[9px] bg-primary/10 text-primary px-1">{t("badgeAuto")}</Badge>
              )}
              {!child.isAutoActual && (
                <button type="button" className="text-muted-foreground hover:text-foreground"
                  onClick={() => setExpandId(isExpanded ? null : child.id)}>
                  <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>
              )}
            </div>
          </td>
          <td className={`px-2 py-1.5 text-right font-mono text-xs font-bold ${variance >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-500"}`}>
            <div className="flex items-center justify-end gap-1">
              <button type="button"
                className={`p-0.5 rounded hover:bg-muted ${noteText ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                title={noteText || t("varianceNoteTitle")}
                onClick={() => { setVarianceNoteLine(child); setVarianceNoteText(child.notes || "") }}>
                <MessageSquare className="h-3 w-3" />
              </button>
              <span>{variance >= 0 ? "+" : ""}{variancePct.toFixed(1)}%</span>
            </div>
          </td>
          <td className="px-2 py-1.5 text-center">
            <button onClick={() => { if (confirm(t("confirmDeleteLine") + " «" + child.category + "»?")) deleteLine.mutate({ id: child.id, planId }) }}
              title={t("hintDeleteLine")}
              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </td>
        </tr>
        {renderExpand(child)}
      </React.Fragment>
    )
  }

  // Render add sub-item inline form
  const renderAddSubItemForm = (parentLine: BudgetLine) => {
    if (addingSubItem !== parentLine.id) return null
    return (
      <tr key={`add-sub-${parentLine.id}`} className="bg-purple-50 dark:bg-purple-900/10 border-t border-border/30">
        <td className="px-3 py-1.5">
          <div className="pl-6 flex items-center gap-2">
            <Input placeholder={t("placeholderCategoryShort")} className="h-6 text-xs flex-1" autoFocus value={newSubItem.category}
              onChange={e => setNewSubItem(d => ({ ...d, category: e.target.value }))}
              onKeyDown={e => { if (e.key === "Enter") handleAddSubItem(parentLine) }} />
          </div>
        </td>
        <td className="px-2 py-1.5">
          <Input placeholder={t("colDepartment")} className="h-6 text-xs" value={newSubItem.department}
            onChange={e => setNewSubItem(d => ({ ...d, department: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") handleAddSubItem(parentLine) }} />
        </td>
        <td className="px-2 py-1.5">
          <Input type="number" placeholder="0" className="h-6 text-xs text-right" value={newSubItem.amount}
            onChange={e => setNewSubItem(d => ({ ...d, amount: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") handleAddSubItem(parentLine) }} />
        </td>
        <td colSpan={2} className="px-2 py-1.5">
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => handleAddSubItem(parentLine)}>
              <CheckCircle className="h-3 w-3 mr-1" /> {t("btnSave")}
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setAddingSubItem(null)}>{t("btnCancel")}</Button>
          </div>
        </td>
        <td />
      </tr>
    )
  }

  // Section renderer (used for revenue; expenses use renderGroupedExpenses below)
  const renderSection = (title: string, sectionLines: BudgetLine[], totPlanned: number, _totForecast: number) => {
    // Turn 36 fix: dedupe by (category, lineType) — see sumActualUniqueCategories jsdoc
    const totActual = sumActualUniqueCategories(sectionLines)
    return (
      <>
        <tr className="bg-muted/40">
          <td colSpan={6} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</td>
        </tr>
        {sectionLines.map(l => [renderRow(l), renderExpand(l)])}
        <tr className="border-y-2 border-border bg-muted/50">
          <td className="px-3 py-2 font-bold text-sm" colSpan={2} title={t("hintSectionTotal")}>{t("totalLabel")} {title.toLowerCase()}</td>
          <td className="px-2 py-2 text-right font-mono text-sm font-bold"><AnimatedNumber value={totPlanned} duration={500} formatter={fmt} /></td>
          <td className="px-2 py-2 text-right font-mono text-sm font-bold text-[#065f46] dark:text-[#6ee7b7]"><AnimatedNumber value={totActual} duration={500} formatter={fmt} /></td>
          <td className="px-2 py-2 text-right font-mono text-sm font-bold">
            {totPlanned > 0 ? `${(((totPlanned - totActual) / totPlanned) * 100).toFixed(1)}%` : "—"}
          </td>
          <td />
        </tr>
      </>
    )
  }

  // Helper: get actual for a line (parent auto-actual takes priority over children sum)
  const getLineActual = (l: BudgetLine): number => {
    if (l.isAutoActual) return autoActualMap.get(l.category) ?? 0
    if (l.children?.length) {
      return l.children.reduce((cs, c) => cs + (c.isAutoActual ? (autoActualMap.get(c.category) ?? 0) : (actualsByCat.get(`${c.category}||${c.lineType}`)?.total ?? 0)), 0)
    }
    return actualsByCat.get(`${l.category}||${l.lineType}`)?.total ?? 0
  }

  // Turn 36 (Workspace actuals 12× over-count fix): post-Turn-34 BudgetLines
  // expanded to 12 rows per (category, lineType) — one per month. Naive
  // `lines.reduce((s,l) => s + getLineActual(l), 0)` reads `actualsByCat.get(key).total`
  // (per-category aggregate) for EACH of the 12 rows → 12× over-count.
  // This helper dedupes by (category, lineType) before summing — each
  // unique tuple contributes its full actual exactly once. Plan side is
  // unaffected (each row carries its own monthly plannedAmount; sum across
  // 12 rows = annual = correct).
  const sumActualUniqueCategories = (sectionLines: BudgetLine[]): number => {
    const seen = new Set<string>()
    let sum = 0
    for (const l of sectionLines) {
      const key = `${l.category}||${l.lineType}`
      if (seen.has(key)) continue
      seen.add(key)
      sum += getLineActual(l)
    }
    return sum
  }

  // Universal grouped section renderer with per-section add form
  const renderGroupedSection = (title: string, sectionLines: BudgetLine[], totPlanned: number, sectionHintKey?: string, sectionLineType?: string) => {
    const totActual = sumActualUniqueCategories(sectionLines)
    const sectionKey = sectionLineType || title.toLowerCase()
    const isCollapsed = collapsedSections.has(sectionKey)

    return (
      <>
        {/* Clickable section header with totals — always visible */}
        <tr
          className="bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors select-none"
          onClick={() => toggleSection(sectionKey)}
        >
          <td colSpan={2} className="px-3 pt-2 pb-1.5">
            <div className="flex items-center gap-2">
              <svg className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</div>
                {sectionHintKey && <div className="text-[10px] text-muted-foreground/60 font-normal mt-0.5">{t(sectionHintKey)}</div>}
              </div>
            </div>
          </td>
          <td className="px-2 pt-2 pb-1.5 text-right font-mono text-sm font-bold"><AnimatedNumber value={totPlanned} duration={500} formatter={fmt} /></td>
          <td className="px-2 pt-2 pb-1.5 text-right font-mono text-sm font-bold text-[#065f46] dark:text-[#6ee7b7]"><AnimatedNumber value={totActual} duration={500} formatter={fmt} /></td>
          <td className="px-2 pt-2 pb-1.5 text-right font-mono text-sm font-bold">
            {totPlanned > 0 ? `${(((totPlanned - totActual) / totPlanned) * 100).toFixed(1)}%` : "—"}
          </td>
          <td className="pt-2 pb-1.5">
            <span className="text-[10px] text-muted-foreground">
              {/* Turn 36 fix: dedupe by (category, lineType) — post-Turn-34 expansion has 12 rows per category, not 1 */}
              {new Set(sectionLines.map((l) => `${l.category}||${l.lineType}`)).size}
            </span>
          </td>
        </tr>
        {/* Detail rows — only when expanded */}
        {!isCollapsed && (() => {
          const isCostSection = sectionLineType === "expense" || sectionLineType === "cogs"

          // For expense/cogs lines with "prefix — dept" format, group by prefix with subtotals
          if (isCostSection && sectionLines.some(l => l.category.includes(" — "))) {
            const groups = new Map<string, BudgetLine[]>()
            const ungrouped: BudgetLine[] = []
            for (const l of sectionLines) {
              if (l.category.includes(" — ")) {
                const prefix = l.category.split(" — ")[0]
                if (!groups.has(prefix)) groups.set(prefix, [])
                groups.get(prefix)!.push(l)
              } else {
                ungrouped.push(l)
              }
            }

            const getLineActual = (l: BudgetLine) =>
              l.isAutoActual ? (autoActualMap.get(l.category) ?? 0) : (actualsByCat.get(`${l.category}||${l.lineType}`)?.total ?? 0)

            return (
              <>
                {Array.from(groups.entries()).map(([prefix, groupLines]) => {
                  const grpPlanned = groupLines.reduce((s, l) => s + l.plannedAmount, 0)
                  // Turn 36 fix: dedupe by (category, lineType) to avoid 12× over-count post-Turn-34 expansion
                  const grpActual = (() => {
                    const seen = new Set<string>()
                    let sum = 0
                    for (const l of groupLines) {
                      const key = `${l.category}||${l.lineType}`
                      if (seen.has(key)) continue
                      seen.add(key)
                      sum += getLineActual(l)
                    }
                    return sum
                  })()
                  const grpVar = grpPlanned > 0 ? ((grpPlanned - grpActual) / grpPlanned * 100).toFixed(1) + "%" : "—"
                  return (
                    <React.Fragment key={`grp-${prefix}`}>
                      <tr className="bg-muted border-t-2 border-border">
                        <td colSpan={2} className="px-4 py-2">
                          <span className="text-[13px] font-bold text-foreground/70 tracking-wide">{prefix}</span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs font-semibold text-muted-foreground"><AnimatedNumber value={grpPlanned} duration={400} formatter={fmt} /></td>
                        <td className="px-2 py-2 text-right font-mono text-xs font-semibold text-muted-foreground"><AnimatedNumber value={grpActual} duration={400} formatter={fmt} /></td>
                        <td className="px-2 py-2 text-right font-mono text-xs font-semibold text-muted-foreground">{grpVar}</td>
                        <td />
                      </tr>
                      {groupLines.map(l => {
                        const isGroupParent = (l.children && l.children.length > 0) || (l.notes && l.notes.startsWith("group:"))
                        const groupTag = l.notes ?? ""
                        const isOpen = expandedGroups.has(groupTag.replace("group:", ""))
                        if (isGroupParent) {
                          return (
                            <React.Fragment key={l.id}>
                              {renderGroupHeader(l)}
                              {renderAddSubItemForm(l)}
                              {isOpen && (l.children ?? []).map(child => renderChildRow(child))}
                            </React.Fragment>
                          )
                        }
                        return <React.Fragment key={l.id}>{renderRow(l)}{renderExpand(l)}</React.Fragment>
                      })}
                    </React.Fragment>
                  )
                })}
                {ungrouped.map(l => {
                  const isGroupParent = (l.children && l.children.length > 0) || (l.notes && l.notes.startsWith("group:"))
                  const groupTag = l.notes ?? ""
                  const isOpen = expandedGroups.has(groupTag.replace("group:", ""))
                  if (isGroupParent) {
                    return (
                      <React.Fragment key={l.id}>
                        {renderGroupHeader(l)}
                        {renderAddSubItemForm(l)}
                        {isOpen && (l.children ?? []).map(child => renderChildRow(child))}
                      </React.Fragment>
                    )
                  }
                  return <React.Fragment key={l.id}>{renderRow(l)}{renderExpand(l)}</React.Fragment>
                })}
              </>
            )
          }

          // Default: flat render for revenue/cogs
          return sectionLines.map(l => {
            const isGroupParent = (l.children && l.children.length > 0) || (l.notes && l.notes.startsWith("group:"))
            const groupTag = l.notes ?? ""
            const isOpen = expandedGroups.has(groupTag.replace("group:", ""))
            if (isGroupParent) {
              return (
                <React.Fragment key={l.id}>
                  {renderGroupHeader(l)}
                  {renderAddSubItemForm(l)}
                  {isOpen && (l.children ?? []).map(child => renderChildRow(child))}
                </React.Fragment>
              )
            }
            return <React.Fragment key={l.id}>{renderRow(l)}{renderExpand(l)}</React.Fragment>
          })
        })()}
        {/* Per-section add form (only when expanded) */}
        {!isCollapsed && sectionLineType && addingSection === sectionLineType ? (
          <>
            <tr className="bg-green-50/50 dark:bg-green-900/5">
              <td colSpan={6} className="px-3 py-1.5">
                <div className="flex items-center gap-1">
                  <Button size="sm" variant={addMode === "line" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setAddMode("line")}>{t("addAsLine")}</Button>
                  <Button size="sm" variant={addMode === "toGroup" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setAddMode("toGroup")}>{t("addToGroup")}</Button>
                  <Button size="sm" variant={addMode === "newGroup" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setAddMode("newGroup")}>{t("addAsGroup")}</Button>
                </div>
              </td>
            </tr>
            <tr className="bg-green-50 dark:bg-green-900/10">
              <td className="px-2 py-1.5">
                <div className="flex flex-col gap-1">
                  {addMode === "toGroup" && (
                    <select value={newRow.parentId} onChange={e => setNewRow(d => ({ ...d, parentId: e.target.value }))} className="h-7 rounded-md border border-input bg-background px-2 text-xs w-full">
                      <option value="">{t("selectGroup")}</option>
                      {parentGroups.map((g: BudgetLine) => <option key={g.id} value={g.id}>{g.category}</option>)}
                    </select>
                  )}
                  <Input placeholder={addMode === "newGroup" ? t("newGroupName") : t("placeholderCategoryShort")} className="h-7 text-xs" value={newRow.category} onChange={e => setNewRow(d => ({ ...d, category: e.target.value }))} autoFocus
                    onKeyDown={e => { if (e.key === "Enter") handleAddRow(); if (e.key === "Escape") setAddingSection(null) }} />
                </div>
              </td>
              {addMode !== "newGroup" ? (
                <>
                  <td className="px-2 py-1.5"><Input placeholder={t("colDepartment")} className="h-7 text-xs" value={newRow.department ?? ""} onChange={e => setNewRow(d => ({ ...d, department: e.target.value }))} /></td>
                  <td className="px-2 py-1.5"><Input type="number" placeholder="0" className="h-7 text-xs text-right" value={newRow.plannedAmount} onChange={e => setNewRow(d => ({ ...d, plannedAmount: e.target.value }))} /></td>
                </>
              ) : (
                <td colSpan={2} className="px-2 py-1 text-[10px] text-muted-foreground align-middle">{t("wsAddSubcategoryHint")}</td>
              )}
              <td />
              <td className="px-2 py-1.5 text-center">
                <div className="flex gap-1 justify-center">
                  <Button size="sm" variant="default" className="h-7 text-xs" onClick={handleAddRow}><CheckCircle className="h-3 w-3 mr-1" />{t("btnSave")}</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setAddingSection(null); setAddMode("line") }}>{t("btnCancel")}</Button>
                </div>
              </td>
              <td />
            </tr>
          </>
        ) : (!isCollapsed && sectionLineType) ? (
          <tr className="border-t border-dashed border-border/20">
            <td colSpan={6} className="px-3 py-1">
              <button onClick={() => { setAddingSection(sectionLineType); setAddMode("line"); setNewRow(d => ({ ...d, parentId: "" })) }} className="text-[11px] text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1">
                <Plus className="h-3 w-3" /> {t("btnAddRow")}
              </button>
            </td>
          </tr>
        ) : null}
      </>
    )
  }

  const planLabel = t("colPlan")
  const actualLabel = t("colActual")
  const MAX_CHART_ITEMS = 8

  const expenseAllData = byCategory
    .filter((c: any) => c.lineType === "expense" && (c.planned > 0 || c.actual > 0))
    .sort((a: any, b: any) => Math.max(b.actual, b.planned) - Math.max(a.actual, a.planned))

  const expenseBarData = (() => {
    const toRow = (c: any) => ({
      name: c.category.length > 20 ? c.category.slice(0, 20) + "…" : c.category,
      [planLabel]: Math.round(c.planned),
      [actualLabel]: Math.round(c.actual),
    })
    if (expenseAllData.length <= MAX_CHART_ITEMS + 1) return expenseAllData.map(toRow)
    const top = expenseAllData.slice(0, MAX_CHART_ITEMS).map(toRow)
    const rest = expenseAllData.slice(MAX_CHART_ITEMS)
    top.push({ name: `Other (${rest.length})`, [planLabel]: Math.round(rest.reduce((s: number, c: any) => s + c.planned, 0)), [actualLabel]: Math.round(rest.reduce((s: number, c: any) => s + c.actual, 0)) })
    return top
  })()

  const revenueAllData = byCategory
    .filter((c: any) => c.lineType === "revenue" && (c.planned > 0 || c.actual > 0))
    .sort((a: any, b: any) => Math.max(b.actual, b.planned) - Math.max(a.actual, a.planned))

  const revenueBarData = (() => {
    const toRow = (c: any) => ({
      name: c.category.length > 20 ? c.category.slice(0, 20) + "…" : c.category,
      [planLabel]: Math.round(c.planned),
      [actualLabel]: Math.round(c.actual),
    })
    if (revenueAllData.length <= MAX_CHART_ITEMS + 1) return revenueAllData.map(toRow)
    const top = revenueAllData.slice(0, MAX_CHART_ITEMS).map(toRow)
    const rest = revenueAllData.slice(MAX_CHART_ITEMS)
    top.push({ name: `Other (${rest.length})`, [planLabel]: Math.round(rest.reduce((s: number, c: any) => s + c.planned, 0)), [actualLabel]: Math.round(rest.reduce((s: number, c: any) => s + c.actual, 0)) })
    return top
  })()

  // Total costs = OpEx only (COGS allocates same costs by service, not additional)
  const totalCostPlanned = totalExpensePlanned
  const totalCostActual = totalExpenseActual
  // Expense execution: how much of total cost budget was spent
  const expExecPct = totalCostPlanned > 0 ? (totalCostActual / totalCostPlanned) * 100 : 0
  // Overspend alert
  const overspendPct = expExecPct - 100
  const overspendAmount = totalCostActual - totalCostPlanned

  // Composite budget execution: 60% revenue achievement + 40% cost discipline.
  // Only meaningful once actuals exist — previously cost discipline defaulted to
  // 100% when there were no actuals, producing a misleading "40% composite" on
  // an untouched plan.
  const hasAnyActuals = totalRevenueActual > 0 || totalCostActual > 0
  const revAchieve = totalRevenuePlanned > 0 ? Math.min((totalRevenueActual / totalRevenuePlanned) * 100, 150) : 0
  const costDisc = totalCostActual > 0 && totalCostPlanned > 0 ? Math.min((totalCostPlanned / totalCostActual) * 100, 150) : 0
  const budgetExecPct = hasAnyActuals ? Math.max(0, Math.round(revAchieve * 0.6 + costDisc * 0.4)) : 0
  const budgetExecColor = !hasAnyActuals ? "amber" as const : budgetExecPct >= 80 ? "green" as const : budgetExecPct >= 50 ? "amber" as const : "red" as const
  const budgetExecEmoji = !hasAnyActuals ? "⏳" : budgetExecPct >= 80 ? "🟢" : budgetExecPct >= 50 ? "🟡" : "🔴"
  const budgetExecLabel = hasAnyActuals ? `${budgetExecPct}% composite score` : "No actuals yet"

  // Turn 36 fix: dedupe by (category, lineType) — see sumActualUniqueCategories jsdoc
  const totExpActual = sumActualUniqueCategories(expenseLines)
  const totRevActual = sumActualUniqueCategories(revenueLines)
  const totCOGSActual = sumActualUniqueCategories(cogsLines)

  return (
    <div className="space-y-6">
      {/* ROW 0: Budget Change History */}
      <BudgetChangeHistory planId={planId} />

      {/* ROW 1: 4 Dark KPI Scorecards (Power BI style) */}
      {(() => {
        const netPosition = computeOperatingProfit(totalRevenuePlanned, totalCOGSPlanned, totalCostPlanned)
        const grossMarginPct = totalRevenuePlanned > 0 ? ((totalRevenuePlanned - totalCOGSPlanned) / totalRevenuePlanned * 100) : 0
        const revExecPct = totalRevenuePlanned > 0 ? Math.round((totalRevenueActual / totalRevenuePlanned) * 100) : 0
        const lineCount = lines.length
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Revenue Budget */}
            <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-200 dark:from-indigo-950/30 dark:to-indigo-900/20 dark:border-indigo-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("sectionRevenues")}</span>
                <div className="h-9 w-9 rounded-full bg-indigo-200 dark:bg-indigo-800 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                </div>
              </div>
              <div className="text-2xl font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{fmtK(totalRevenuePlanned)} ₼</div>
              <div className="text-xs text-muted-foreground mt-1">{new Set(revenueLines.map((l: BudgetLine) => `${l.category}||${l.lineType}`)).size} {t("colCategory").toLowerCase()} · {revExecPct}% {t("kpiExecution").toLowerCase()}</div>
            </div>
            {/* COGS Budget */}
            <div className="rounded-xl bg-gradient-to-br from-cyan-50 to-cyan-100 border border-cyan-200 dark:from-cyan-950/30 dark:to-cyan-900/20 dark:border-cyan-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("sectionCOGS")}</span>
                <div className="h-9 w-9 rounded-full bg-cyan-200 dark:bg-cyan-800 flex items-center justify-center">
                  <Banknote className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                </div>
              </div>
              <div className="text-2xl font-bold tabular-nums text-cyan-700 dark:text-cyan-300">{fmtK(totalCOGSPlanned)} ₼</div>
              <div className="text-xs text-muted-foreground mt-1">{t("sectionMargin").split("(")[0].trim()}: {grossMarginPct.toFixed(1)}%</div>
            </div>
            {/* Operating Expenses */}
            <div className="rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 dark:from-orange-950/30 dark:to-orange-900/20 dark:border-orange-800 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("sectionExpenses")}</span>
                <div className="h-9 w-9 rounded-full bg-orange-200 dark:bg-orange-800 flex items-center justify-center">
                  <DollarSign className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                </div>
              </div>
              <div className="text-2xl font-bold tabular-nums text-orange-700 dark:text-orange-300">{fmtK(totalCostPlanned)} ₼</div>
              <div className="text-xs text-muted-foreground mt-1">{new Set(expenseLines.map((l: BudgetLine) => `${l.category}||${l.lineType}`)).size} {t("colCategory").toLowerCase()} · {Math.round(expExecPct)}% {t("kpiExecution").toLowerCase()}</div>
            </div>
            {/* Net Budget Position */}
            <div className={`rounded-xl p-5 ${netPosition >= 0 ? "bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 dark:from-emerald-950/30 dark:to-emerald-900/20 dark:border-emerald-800" : "bg-gradient-to-br from-red-50 to-red-100 border border-red-200 dark:from-red-950/30 dark:to-red-900/20 dark:border-red-800"}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{t("operatingProfit")}</span>
                <div className={`h-9 w-9 rounded-full flex items-center justify-center ${netPosition >= 0 ? "bg-emerald-200 dark:bg-emerald-800" : "bg-red-200 dark:bg-red-800"}`}>
                  {netPosition >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />}
                </div>
              </div>
              <div className={`text-2xl font-bold tabular-nums ${netPosition >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{netPosition < 0 ? "(" + fmtK(Math.abs(netPosition)) + ")" : fmtK(netPosition)} ₼</div>
              <div className="text-xs text-muted-foreground mt-1">{lineCount} {t("colCategory").toLowerCase()} · {t("kpiVariance")}: {totalVariance >= 0 ? "+" : ""}{fmtK(totalVariance)} ₼</div>
            </div>
          </div>
        )
      })()}

      {/* ROW 2: Waterfall + Gauge */}
      {byCategory.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 border-0 shadow-md">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-semibold">{t("chartWaterfall") || "Budget Waterfall"}</CardTitle>
              <p className="text-[10px] text-muted-foreground">{t("chartWaterfallSubtitle") || "Budget → Forecast → Actual → Variance → Projection"}</p>
            </CardHeader>
            <CardContent className="pb-3">
              <BudgetWaterfallChart
                totalPlanned={totalPlanned}
                totalForecast={totalForecast}
                totalActual={totalActual}
                totalVariance={totalVariance}
                yearEndProjection={yearEndProjection}
              />
            </CardContent>
          </Card>
          <Card className="lg:col-span-1 border-0 shadow-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{t("budgetExecution") || "Budget Execution"}</CardTitle>
              <p className="text-[10px] text-muted-foreground">{budgetExecEmoji} {budgetExecLabel}</p>
            </CardHeader>
            <CardContent className="flex justify-center">
              <BudgetExecutionGauge
                executionPct={budgetExecPct}
                expenseExecPct={expExecPct}
                revenueExecPct={totalRevenuePlanned > 0 ? (totalRevenueActual / totalRevenuePlanned) * 100 : 0}
                elapsedPct={elapsedPct}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ROW 3: Category Bars */}
      {byCategory.length > 0 && (
        <Card className="border-0 shadow-md">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t("chartPlanForecastActual") || "Plan vs Actual by Category"}</CardTitle>
            <p className="text-[10px] text-muted-foreground">{byCategory.filter((c: any) => c.planned > 0 || c.actual > 0).length} active categories</p>
          </CardHeader>
          <CardContent className="pt-0">
            <BudgetCategoryBars categories={byCategory} />
          </CardContent>
        </Card>
      )}

      {/* Overspend alert banner */}
      {overspendPct > 25 && (
        <div className="rounded-lg border-2 border-red-500 bg-red-100 dark:bg-red-900/50 dark:border-red-700 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-700 dark:text-red-300 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-red-800 dark:text-red-200 text-sm">{t("alertOverspendTitle")}</p>
            <p className="text-red-700 dark:text-red-300 text-xs mt-0.5">
              {t("alertOverspendDesc", { pct: Math.round(overspendPct), amount: fmt(overspendAmount) })}
            </p>
          </div>
        </div>
      )}
      {overspendPct > 10 && overspendPct <= 25 && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-700 dark:text-amber-400 text-sm">{t("alertWarningTitle")}</p>
            <p className="text-amber-600 dark:text-amber-300 text-xs mt-0.5">
              {t("alertWarningDesc", { pct: Math.round(overspendPct), amount: fmt(overspendAmount) })}
            </p>
          </div>
        </div>
      )}

      {/* Executive Summary */}
      {(totalCostPlanned > 0 || totalRevenuePlanned > 0) && (
        <div className="rounded-xl bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900/50 dark:to-slate-800/50 border border-slate-200 dark:border-slate-700/50 px-5 py-3.5 text-sm text-muted-foreground flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
            <BarChart2 className="h-4 w-4 text-slate-600 dark:text-slate-300" />
          </div>
          <div>
            {totalCostActual > totalCostPlanned ? (
              <span>{t("summaryOverspend", { period: analytics?.plan?.name ?? "", pct: Math.round(overspendPct), amount: fmt(overspendAmount) })}</span>
            ) : totalCostPlanned > 0 ? (
              <span>{t("summaryUnderBudget", { period: analytics?.plan?.name ?? "", pct: Math.round(100 - expExecPct), amount: fmt(totalCostPlanned - totalCostActual) })}</span>
            ) : null}
            {totalRevenuePlanned === 0 && totalCostPlanned > 0 && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">{t("summaryNoRevenue")}</span>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {autoActualTotal > 0 && (
          <Button size="sm" variant="outline" title={t("hintBtnSyncActuals")} onClick={handleSync} disabled={syncActuals.isPending}>
            {syncActuals.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2 className="h-4 w-4 mr-1" />}
            {t("btnUpdateActual")}
          </Button>
        )}
        <ApplyTemplatesButton planId={planId} />
        <a href={`/api/budgeting/export?planId=${planId}`} download>
          <Button size="sm" variant="outline" title={t("hintBtnExport")}><DollarSign className="h-4 w-4 mr-1" /> {t("btnExport")}</Button>
        </a>
        <div className="flex items-center border rounded-md overflow-hidden">
          <Button size="sm" variant={workspaceView === "list" ? "default" : "ghost"} className="h-8 text-xs rounded-none px-2"
            onClick={() => setWorkspaceView("list")} title={t("wsViewList")}>
            <List className="h-4 w-4" />
          </Button>
          <Button size="sm" variant={workspaceView === "matrix" ? "default" : "ghost"} className="h-8 text-xs rounded-none px-2"
            onClick={() => setWorkspaceView("matrix")} title={t("wsViewMatrix")}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1" />
        <Input placeholder={t("searchCategory")} title={t("hintSearchCategory")} value={filterText} onChange={e => setFilterText(e.target.value)} className="h-8 w-48 text-xs" />
        <select value={filterType} onChange={e => setFilterType(e.target.value as any)} title={t("hintFilterType")} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
          <option value="all">{t("filterAll")}</option>
          <option value="expense">{t("filterExpenses")}</option>
          <option value="revenue">{t("filterRevenues")}</option>
        </select>
        <Button size="sm" variant={showMaterialOnly ? "default" : "outline"} className="h-8 text-xs"
          onClick={() => setShowMaterialOnly(!showMaterialOnly)} title={t("hintFilterMaterial")}>
          {t("filterMaterial")}
        </Button>
        {showMaterialOnly && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>≥</span>
            <Input type="number" value={materialityPct} onChange={e => setMaterialityPct(Number(e.target.value))} className="h-7 w-14 text-xs text-right" />
            <span>%</span>
            <span>{t("or")}</span>
            <Input type="number" value={materialityAbs} onChange={e => setMaterialityAbs(Number(e.target.value))} className="h-7 w-20 text-xs text-right" />
            <span>₼</span>
          </div>
        )}
        <Button size="sm" variant={compactNumbers ? "default" : "outline"} className="h-8 text-xs font-mono"
          onClick={() => setCompactNumbers(!compactNumbers)} title={t("wsCompactNumbersTitle")}>
          {compactNumbers ? "1.2M" : "1,234"}
        </Button>
      </div>

      {/* === MATRIX VIEW === */}
      {workspaceView === "matrix" && analytics?.matrix && analytics.matrix.cells.length > 0 && (
        <BudgetMatrixGrid matrix={analytics.matrix} compact={compactNumbers} />
      )}
      {workspaceView === "matrix" && (!analytics?.matrix || analytics.matrix.cells.length === 0) && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <LayoutGrid className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium mb-2">{t("matrixNotConfigured")}</p>
            <p className="text-sm mb-4">{t("matrixNotConfiguredHint")}</p>
            <Button
              onClick={async () => {
                try {
                  const res = await fetch(`/api/budgeting/matrix-seed`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ planId }),
                  })
                  const json = await res.json()
                  if (!res.ok) {
                    alert(json.error || t("wsGenMatrixFailed"))
                    return
                  }
                  window.location.reload()
                } catch (err) {
                  alert(t("wsNetworkError"))
                }
              }}
            >
              <LayoutGrid className="h-4 w-4 mr-2" />
              {t("matrixGenerate")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* === MAIN EDITABLE GRID === */}
      {workspaceView === "list" && (<Card className="border-0 shadow-md overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#1a3050] border-b-2 border-white/10">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/90"><span className="inline-flex items-center gap-1.5">{t("colCategory")} <InfoHint text={t("hintColCategory")} size={12} /></span></th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/70"><span className="inline-flex items-center gap-1.5">{t("colDepartment")} <InfoHint text={t("hintColDepartment")} size={12} /></span></th>
                  <th className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-sky-300"><span className="inline-flex items-center gap-1 justify-end">{t("colPlan")} ₼ <InfoHint text={t("hintColPlan")} size={12} /></span></th>
                  <th className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-emerald-300"><span className="inline-flex items-center gap-1 justify-end">{t("colActual")} ₼ <InfoHint text={t("hintColActual")} size={12} /></span></th>
                  <th className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-amber-300"><span className="inline-flex items-center gap-1 justify-end">{t("colVariancePct")} <InfoHint text={t("hintColVariance")} size={12} /></span></th>
                  <th className="px-2 py-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {renderGroupedSection(t("sectionRevenues"), revenueLines, totRevPlanned, "hintSectionRevenue", "revenue")}
                {revenueLines.length === 0 && (
                  <tr className="bg-amber-50/50 dark:bg-amber-950/10">
                    <td colSpan={6} className="px-4 py-2 text-xs text-amber-700 dark:text-amber-400 italic">
                      {t("hintAddRevenue")}
                    </td>
                  </tr>
                )}
                {renderGroupedSection(t("sectionCOGS"), cogsLines, totCOGSPlanned, "hintSectionCOGS", "cogs")}

                {/* Gross Profit row = Revenue − COGS */}
                {(revenueLines.length > 0 || cogsLines.length > 0) && (() => {
                  const gpPlanned = totRevPlanned - totCOGSPlanned
                  const gpActual = totRevActual - totCOGSActual
                  const gpNeg = gpActual < 0
                  const gpVarPct = varPct(gpActual, gpPlanned)
                  return (
                  <tr className={`border-y-2 ${gpNeg ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10" : "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10"}`}>
                    <td className="px-3 py-2" colSpan={2}>
                      <div className="font-bold text-sm">{t("grossProfit")}</div>
                      <div className="text-[10px] text-muted-foreground/60 font-normal">{t("hintGrossProfit")}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-bold"><AnimatedNumber value={gpPlanned} duration={500} formatter={fmt} /></td>
                    <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${gpNeg ? "text-red-600 dark:text-red-400" : "text-[#065f46] dark:text-[#6ee7b7]"}`}><AnimatedNumber value={gpActual} duration={500} formatter={fmt} /></td>
                    <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${gpVarPct === null ? "text-muted-foreground" : gpVarPct >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-600 dark:text-red-400"}`}>
                      {gpVarPct === null ? "—" : `${gpVarPct >= 0 ? "+" : ""}${gpVarPct.toFixed(1)}%`}
                    </td>
                    <td className="w-10" />
                  </tr>
                  )
                })()}

                {renderGroupedSection(t("sectionExpenses"), expenseLines, totExpPlanned, "hintSectionExpenses", "expense")}

                {/* Operating Profit row — math via computeOperatingProfit helper (Revenue − COGS − OpEx) */}
                {(expenseLines.length > 0 || revenueLines.length > 0 || cogsLines.length > 0) && (() => {
                  const opPlanned = computeOperatingProfit(totRevPlanned, totCOGSPlanned, totExpPlanned)
                  const opActual = computeOperatingProfit(totRevActual, totCOGSActual, totExpActual)
                  const opNeg = opActual < 0
                  const opVarPct = varPct(opActual, opPlanned)
                  return (
                  <tr className={`border-y-2 ${opNeg ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10" : "border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10"}`}>
                    <td className="px-3 py-2" colSpan={2}>
                      <div className="font-bold text-sm">{t("operatingProfit")}</div>
                      <div className="text-[10px] text-muted-foreground/60 font-normal">{t("hintOperatingProfit")}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-sm font-bold"><AnimatedNumber value={opPlanned} duration={500} formatter={fmt} /></td>
                    <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${opNeg ? "text-red-600 dark:text-red-400" : "text-[#065f46] dark:text-[#6ee7b7]"}`}><AnimatedNumber value={opActual} duration={500} formatter={fmt} /></td>
                    <td className={`px-2 py-2 text-right font-mono text-sm font-bold ${opVarPct === null ? "text-muted-foreground" : opVarPct >= 0 ? "text-[#065f46] dark:text-[#6ee7b7]" : "text-red-600 dark:text-red-400"}`}>
                      {opVarPct === null ? "—" : `${opVarPct >= 0 ? "+" : ""}${opVarPct.toFixed(1)}%`}
                    </td>
                    <td className="w-10" />
                  </tr>
                  )
                })()}

                {/* Empty state */}
                {lines.length === 0 && !addingSection && (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-muted-foreground">
                      {t("emptyNoLines")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>)}

      {/* Drill-down Sheet for fact values */}
      <Sheet open={!!drillDownLine} onOpenChange={open => { if (!open) setDrillDownLine(null) }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("drillDownTitle")}: {drillDownLine?.category}</SheetTitle>
            <SheetDescription className="sr-only">{t("drillDownTitle")}</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {drillDownLine?.isAutoActual ? (
              <div className="space-y-2">
                <Badge className="bg-primary/10 text-primary">{t("costModelSource")}</Badge>
                <div className="text-sm text-muted-foreground">{t("costModelKey")}: <code className="bg-muted px-1 rounded">{drillDownLine.costModelKey || "—"}</code></div>
                <div className="text-lg font-mono font-bold">{fmt(autoActualMap.get(drillDownLine.category) ?? 0)}</div>
              </div>
            ) : (
              <div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1.5 text-xs font-medium">{t("colDate")}</th>
                      <th className="text-left py-1.5 text-xs font-medium">{t("colDescription")}</th>
                      <th className="text-right py-1.5 text-xs font-medium">{t("colAmount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(drillDownLine ? (actualsByCat.get(`${drillDownLine.category}||${drillDownLine.lineType}`)?.items ?? []) : []).map(a => (
                      <tr key={a.id} className="border-b border-border/30">
                        <td className="py-1.5 text-xs">{a.expenseDate || "—"}</td>
                        <td className="py-1.5 text-xs">{a.description || "—"}</td>
                        <td className="py-1.5 text-right font-mono text-xs">{fmt(a.actualAmount)}</td>
                      </tr>
                    ))}
                    {drillDownLine && (actualsByCat.get(`${drillDownLine.category}||${drillDownLine.lineType}`)?.items ?? []).length === 0 && (
                      <tr><td colSpan={3} className="py-4 text-center text-muted-foreground text-xs italic">{t("noActuals")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Variance note Dialog */}
      <Dialog open={!!varianceNoteLine} onOpenChange={open => { if (!open) setVarianceNoteLine(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("varianceNoteTitle")}: {varianceNoteLine?.category}</DialogTitle>
            <DialogDescription className="sr-only">{t("varianceNotePlaceholder")}</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={t("varianceNotePlaceholder")}
            value={varianceNoteText}
            onChange={e => setVarianceNoteText(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setVarianceNoteLine(null)}>{t("btnCancel")}</Button>
            <Button onClick={() => {
              if (varianceNoteLine) {
                updateLine.mutate({ id: varianceNoteLine.id, planId, notes: varianceNoteText })
                setVarianceNoteLine(null)
              }
            }}>{t("btnSave")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* F7: Multi-Currency FX Summary */}
      <BudgetFxSummary
        lines={(lines as any[]).flatMap((l: any) => [l, ...(l.children ?? [])])}
        baseCurrency="AZN"
      />
    </div>
  )
}

