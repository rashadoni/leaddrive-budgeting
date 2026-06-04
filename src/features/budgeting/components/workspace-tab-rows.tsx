"use client"
/**
 * WorkspaceTab grid-row renderers — extracted from WorkspaceTab.tsx (Phase 8
 * D1 2026-05-29) to bring that mega-file under the 1000-LOC line. These were
 * closures inside the component capturing ~40 pieces of state + callbacks; the
 * bodies are unchanged — the closure source is now the explicit `ctx` bag
 * destructured at the top of `makeRowRenderers`, so behaviour is identical.
 * The component uses `renderGroupedSection` (the section renderer) and
 * `sumActualUniqueCategories` (also needed by the chart-data prep in the
 * component tail); the rest are internal to the factory.
 */
import React from "react"
import type { Dispatch, SetStateAction } from "react"
import {
  CheckCircle, ChevronDown, ChevronRight, MessageSquare, Pencil, Plus, Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AnimatedNumber } from "@/components/animated-number"
import {
  type BudgetLine,
  type BudgetActual,
  type BudgetCategoryRow,
} from "@/lib/budgeting/types"
import {
  useCreateBudgetLine,
  useDeleteBudgetLine,
  useDeleteBudgetActual,
} from "@/lib/budgeting/hooks"

type NewRowState = {
  category: string
  lineType: string
  plannedAmount: string
  forecastAmount: string
  department: string
  parentId: string
}

export interface RowRendererCtx {
  t: (key: string, values?: Record<string, string | number>) => string
  fmt: (n: number) => string
  planId: string
  lines: BudgetLine[]
  actuals: BudgetActual[]
  actualsByCat: Map<string, { total: number; items: BudgetActual[] }>
  autoActualMap: Map<string, number>
  byCategory: BudgetCategoryRow[]
  editCell: { id: string; field: string } | null
  editValue: string
  setEditValue: Dispatch<SetStateAction<string>>
  expandId: string | null
  setExpandId: Dispatch<SetStateAction<string | null>>
  expandedGroups: Set<string>
  setExpandedGroups: Dispatch<SetStateAction<Set<string>>>
  collapsedSections: Set<string>
  toggleSection: (key: string) => void
  addingSubItem: string | null
  setAddingSubItem: Dispatch<SetStateAction<string | null>>
  newSubItem: { category: string; amount: string; department: string }
  setNewSubItem: Dispatch<SetStateAction<{ category: string; amount: string; department: string }>>
  addingSection: string | null
  setAddingSection: Dispatch<SetStateAction<string | null>>
  addMode: "line" | "toGroup" | "newGroup"
  setAddMode: Dispatch<SetStateAction<"line" | "toGroup" | "newGroup">>
  newRow: NewRowState
  setNewRow: Dispatch<SetStateAction<NewRowState>>
  setDrillDownLine: Dispatch<SetStateAction<BudgetLine | null>>
  setVarianceNoteLine: Dispatch<SetStateAction<BudgetLine | null>>
  setVarianceNoteText: Dispatch<SetStateAction<string>>
  newActual: { amount: string; description: string; date: string }
  setNewActual: Dispatch<SetStateAction<{ amount: string; description: string; date: string }>>
  showMaterialOnly: boolean
  parentGroups: BudgetLine[]
  isMaterial: (l: BudgetLine) => boolean
  startEdit: (id: string, field: string, currentVal: number) => void
  saveEdit: () => Promise<void>
  handleAddRow: () => Promise<void>
  handleAddActual: (category: string, lineType: string) => Promise<void>
  createLine: ReturnType<typeof useCreateBudgetLine>
  deleteLine: ReturnType<typeof useDeleteBudgetLine>
  deleteActual: ReturnType<typeof useDeleteBudgetActual>
}

export function makeRowRenderers(ctx: RowRendererCtx) {
  const {
    t, fmt, planId, lines, actuals, actualsByCat, autoActualMap, byCategory,
    editCell, editValue, setEditValue, expandId, setExpandId,
    expandedGroups, setExpandedGroups, collapsedSections, toggleSection,
    addingSubItem, setAddingSubItem, newSubItem, setNewSubItem,
    addingSection, setAddingSection, addMode, setAddMode, newRow, setNewRow,
    setDrillDownLine, setVarianceNoteLine, setVarianceNoteText,
    newActual, setNewActual, showMaterialOnly, parentGroups, isMaterial,
    startEdit, saveEdit, handleAddRow, handleAddActual,
    createLine, deleteLine, deleteActual,
  } = ctx

  const renderRow = (line: BudgetLine) => {
    const catActuals = actualsByCat.get(`${line.category}||${line.lineType}`)
    // Canonical actual = analytics byCategory.actual (auto + manual + Y4
    // cross-plan code-join), fall back to direct BudgetActual sum. Was gated on
    // isAutoActual → re-keyed budget lines hit the empty BudgetActual map → 0.
    const factValue = autoActualMap.get(line.category) ?? (catActuals?.total ?? 0)
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
            <button type="button" className="font-mono text-sm cursor-pointer hover:bg-primary/5 dark:hover:bg-primary/10 px-1 rounded border border-transparent hover:border-primary/40 transition-colors"
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => { if (confirm(t("confirmDeleteLine") + " «" + line.category + "» " + t("confirmDeleteLineSuffix"))) deleteLine.mutate({ id: line.id, planId }) }}
            title={t("hintDeleteLine")}
            aria-label={t("hintDeleteLine")}
            className="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteActual.mutate({ id: a.id, planId })}
                  title={t("hintDeleteLine")}
                  aria-label={t("hintDeleteLine")}
                  className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
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
    const groupActual = autoActualMap.get(line.category)
      ?? children.reduce((s, c) => {
          return s + (autoActualMap.get(c.category) ?? (actualsByCat.get(`${c.category}||${c.lineType}`)?.total ?? 0))
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/5 dark:hover:bg-primary/10 opacity-60 hover:opacity-100"
              title={t("hintAddSubItem")}
              aria-label={t("hintAddSubItem")}
              onClick={() => setAddingSubItem(addingSubItem === line.id ? null : line.id)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
              title={t("hintDeleteLine")}
              aria-label={t("hintDeleteLine")}
              onClick={() => {
                const childCount = children.length
                const msg = childCount > 0
                  ? `${t("confirmDeleteLine")} «${line.category}» (${childCount} subcategories will be detached)?`
                  : `${t("confirmDeleteLine")} «${line.category}»?`
                if (confirm(msg)) deleteLine.mutate({ id: line.id, planId })
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>
    )
  }

  // Render a child (sub-item) row — indented
  const renderChildRow = (child: BudgetLine) => {
    const factValue = autoActualMap.get(child.category) ?? (actualsByCat.get(`${child.category}||${child.lineType}`)?.total ?? 0)
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
              <button type="button" className="font-mono text-sm cursor-pointer hover:bg-primary/5 dark:hover:bg-primary/10 px-1 rounded border border-transparent hover:border-primary/40 transition-colors"
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => { if (confirm(t("confirmDeleteLine") + " «" + child.category + "»?")) deleteLine.mutate({ id: child.id, planId }) }}
              title={t("hintDeleteLine")}
              aria-label={t("hintDeleteLine")}
              className="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
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
      <tr key={`add-sub-${parentLine.id}`} className="bg-primary/5 dark:bg-primary/10 border-t border-border/30">
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
    // Prefer the canonical analytics actual (auto + manual + Y4 code-join);
    // fall back to the direct BudgetActual sum. Previously gated on
    // isAutoActual, which left re-keyed budget lines on the empty BudgetActual
    // map → fact 0 even though the joined actual existed.
    if (l.children?.length) {
      return l.children.reduce((cs, c) => cs + (autoActualMap.get(c.category) ?? (actualsByCat.get(`${c.category}||${c.lineType}`)?.total ?? 0)), 0)
    }
    return autoActualMap.get(l.category) ?? (actualsByCat.get(`${l.category}||${l.lineType}`)?.total ?? 0)
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
  const renderGroupedSection = (title: string, sectionLines: BudgetLine[], totPlanned: number, sectionHintKey?: string, sectionLineType?: string, aggregateActual?: number) => {
    // Prefer the caller-supplied analytics aggregate (complete; matches the
    // GP/EBITDA blocks + P&L cards) over the per-category dedup sum, which
    // under-counts sections whose budget codes don't all map to the actuals.
    const totActual = aggregateActual ?? sumActualUniqueCategories(sectionLines)
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
              autoActualMap.get(l.category) ?? (actualsByCat.get(`${l.category}||${l.lineType}`)?.total ?? 0)

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
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => { setAddingSection(sectionLineType); setAddMode("line"); setNewRow(d => ({ ...d, parentId: "" })) }}
                className="h-auto p-0 text-[11px]"
              >
                <Plus className="h-3 w-3" /> {t("btnAddRow")}
              </Button>
            </td>
          </tr>
        ) : null}
      </>
    )
  }


  return { renderGroupedSection, sumActualUniqueCategories }
}
