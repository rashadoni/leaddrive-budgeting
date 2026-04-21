"use client"

import { cn } from "@/lib/utils"
import { useState } from "react"
import { useTranslations } from "next-intl"

interface MatrixCostType {
  key: string
  label: string
  isShared: boolean
  color: string | null
}

interface MatrixDepartment {
  key: string
  label: string
  hasRevenue: boolean
  color: string | null
}

interface MatrixCell {
  costTypeKey: string
  costTypeLabel: string
  departmentKey: string | null
  departmentLabel: string | null
  planned: number
  actual: number
  forecast: number
  variance: number
  variancePct: number
  lineType: string
}

interface Totals {
  planned: number
  actual: number
  forecast: number
  variance: number
}

interface MatrixData {
  costTypes: MatrixCostType[]
  departments: MatrixDepartment[]
  cells: MatrixCell[]
  rowTotals: Record<string, Totals>
  colTotals: Record<string, Totals>
  grandTotal: Totals
}

type ViewMode = "planned" | "actual" | "variance"

function fmtNum(n: number, compact = false): string {
  if (compact) {
    if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
    if (Math.abs(n) >= 1_000) return Math.round(n / 1000) + "k"
  }
  return Math.round(n).toLocaleString()
}

export function BudgetMatrixGrid({
  matrix,
  compact = true,
}: {
  matrix: MatrixData
  compact?: boolean
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("planned")
  const t = useTranslations("budgeting")
  const { costTypes, departments, cells, rowTotals, colTotals, grandTotal } = matrix

  // Filter: only departments with hasRevenue (active service departments)
  const activeDepts = departments.filter((d) => d.hasRevenue)
  // Separate cost types: non-shared (per-dept rows) and shared (single row)
  const perDeptCostTypes = costTypes.filter((ct) => !ct.isShared)
  const sharedCostTypes = costTypes.filter((ct) => ct.isShared)

  // Revenue cells by department
  const revenueCells = cells.filter((c) => c.lineType === "revenue")

  function getCellValue(costTypeKey: string, deptKey: string | null): number {
    const cell = cells.find(
      (c) => c.costTypeKey === costTypeKey && (c.departmentKey === deptKey || (!c.departmentKey && !deptKey))
    )
    if (!cell) return 0
    if (viewMode === "planned") return cell.planned
    if (viewMode === "actual") return cell.actual
    return cell.variance
  }

  function getRowTotal(costTypeKey: string): number {
    const t = rowTotals[costTypeKey]
    if (!t) return 0
    if (viewMode === "planned") return t.planned
    if (viewMode === "actual") return t.actual
    return t.variance
  }

  function getColTotal(deptKey: string): number {
    const t = colTotals[deptKey]
    if (!t) return 0
    if (viewMode === "planned") return t.planned
    if (viewMode === "actual") return t.actual
    return t.variance
  }

  function getGrandTotal(): number {
    if (viewMode === "planned") return grandTotal.planned
    if (viewMode === "actual") return grandTotal.actual
    return grandTotal.variance
  }

  // Revenue per dept
  function getRevenueValue(deptKey: string): number {
    const cell = revenueCells.find((c) => c.departmentKey === deptKey)
    if (!cell) return 0
    if (viewMode === "planned") return cell.planned
    if (viewMode === "actual") return cell.actual
    return cell.variance
  }

  const totalRevenue = revenueCells.reduce((s, c) => {
    if (viewMode === "planned") return s + c.planned
    if (viewMode === "actual") return s + c.actual
    return s + c.variance
  }, 0)

  // Margin per dept = revenue - expenses
  function getDeptMargin(deptKey: string): number {
    const rev = getRevenueValue(deptKey)
    const exp = getColTotal(deptKey)
    return rev - exp
  }

  const isEmpty = cells.length === 0

  if (isEmpty) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
        <p className="text-lg font-medium mb-2">{t("matrixEmpty")}</p>
        <p className="text-sm">
          {t("matrixEmptyHint")}
        </p>
      </div>
    )
  }

  const varianceColor = (v: number) =>
    v > 0 ? "text-green-600 dark:text-green-400" : v < 0 ? "text-red-600 dark:text-red-400" : ""

  return (
    <div className="space-y-3">
      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t("matrixShow")}</span>
        {(["planned", "actual", "variance"] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-medium transition-colors",
              viewMode === mode
                ? "bg-blue-600 text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {mode === "planned" ? t("matrixPlan") : mode === "actual" ? t("matrixActual") : t("matrixVariance")}
          </button>
        ))}
      </div>

      {/* Matrix table */}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium text-xs min-w-[160px]">
                {t("matrixCostType")}
              </th>
              {activeDepts.map((d) => (
                <th key={d.key} className="px-3 py-2 text-right font-medium text-xs min-w-[100px]">
                  <div className="flex items-center justify-end gap-1.5">
                    {d.color && (
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                    )}
                    {d.label}
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-bold text-xs min-w-[100px] bg-muted/80">
                {t("matrixTotal")}
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Non-shared cost types — one row per type, cells per dept */}
            {perDeptCostTypes.map((ct) => (
              <tr key={ct.key} className="border-b hover:bg-muted/30 transition-colors">
                <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-medium text-xs">
                  <div className="flex items-center gap-1.5">
                    {ct.color && (
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ct.color }} />
                    )}
                    {ct.label}
                  </div>
                </td>
                {activeDepts.map((d) => {
                  const val = getCellValue(ct.key, d.key)
                  return (
                    <td key={d.key} className={cn("px-3 py-1.5 text-right text-xs tabular-nums", viewMode === "variance" && varianceColor(val))}>
                      {val !== 0 ? fmtNum(val, compact) : "—"}
                    </td>
                  )
                })}
                <td className="px-3 py-1.5 text-right text-xs font-bold tabular-nums bg-muted/30">
                  {fmtNum(getRowTotal(ct.key), compact)}
                </td>
              </tr>
            ))}

            {/* Shared cost types */}
            {sharedCostTypes.map((ct) => (
              <tr key={ct.key} className="border-b hover:bg-muted/30 transition-colors">
                <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-medium text-xs">
                  <div className="flex items-center gap-1.5">
                    {ct.color && (
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ct.color }} />
                    )}
                    {ct.label}
                  </div>
                </td>
                {activeDepts.map(() => (
                  <td key={Math.random()} className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                    —
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right text-xs font-bold tabular-nums bg-muted/30">
                  {fmtNum(getRowTotal(ct.key), compact)}
                </td>
              </tr>
            ))}

            {/* Expense totals row */}
            <tr className="border-b-2 border-double bg-muted/50 font-bold">
              <td className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-xs">{t("matrixTotalExpenses")}</td>
              {activeDepts.map((d) => {
                const val = getColTotal(d.key)
                return (
                  <td key={d.key} className={cn("px-3 py-2 text-right text-xs tabular-nums", viewMode === "variance" && varianceColor(val))}>
                    {fmtNum(val, compact)}
                  </td>
                )
              })}
              <td className="px-3 py-2 text-right text-xs tabular-nums bg-muted/80">
                {fmtNum(getGrandTotal(), compact)}
              </td>
            </tr>

            {/* Revenue row */}
            {revenueCells.length > 0 && (
              <>
                <tr className="border-b hover:bg-green-50/50 dark:hover:bg-green-900/10 transition-colors">
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-medium text-xs text-green-700 dark:text-green-400">
                    {t("matrixRevenue")}
                  </td>
                  {activeDepts.map((d) => {
                    const val = getRevenueValue(d.key)
                    return (
                      <td key={d.key} className="px-3 py-1.5 text-right text-xs tabular-nums text-green-700 dark:text-green-400">
                        {val !== 0 ? fmtNum(val, compact) : "—"}
                      </td>
                    )
                  })}
                  <td className="px-3 py-1.5 text-right text-xs font-bold tabular-nums bg-muted/30 text-green-700 dark:text-green-400">
                    {fmtNum(totalRevenue, compact)}
                  </td>
                </tr>

                {/* Margin row */}
                <tr className="bg-muted/30 font-bold">
                  <td className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-xs">{t("matrixMargin")}</td>
                  {activeDepts.map((d) => {
                    const margin = getDeptMargin(d.key)
                    return (
                      <td key={d.key} className={cn("px-3 py-2 text-right text-xs tabular-nums", varianceColor(margin))}>
                        {margin > 0 ? "+" : ""}{fmtNum(margin, compact)}
                      </td>
                    )
                  })}
                  <td className={cn("px-3 py-2 text-right text-xs tabular-nums bg-muted/80", varianceColor(totalRevenue - getGrandTotal()))}>
                    {(totalRevenue - getGrandTotal()) > 0 ? "+" : ""}{fmtNum(totalRevenue - getGrandTotal(), compact)}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
