"use client"

/**
 * Phase 7.G Turn LX — Phase 3.1 first slice: VarianceTab extracted from
 * `src/app/(dashboard)/budgeting/page.tsx` into its own feature module.
 *
 * Closes architect Turn-LIX flag: page.tsx hit 5479 LOC, my own LIX-shipped
 * VarianceTab added ~280 LOC inline, deepening the Phase 3.1 debt called
 * out in CLAUDE.md §debt #2 ("budgeting/page.tsx is 5000+ lines"). This
 * is the FIRST tab moved to its own file under the new
 * `src/features/budgeting/components/` namespace, establishing the
 * pattern for future Phase 3.1 incremental extractions of other tabs
 * (ComparisonTab ~1200 LOC, ForecastTab, PLTab, etc.).
 *
 * Component contract unchanged from inline LIX version:
 *   - Single-plan plan-vs-actual % delta surface.
 *   - Reads `useBudgetPlans()` + `useBudgetAnalytics(planId)` (no new
 *     API surface; no schema change).
 *   - UX: radio-style plan picker → KPI strip → filter+sort controls →
 *     sortable variance table with band-color rows.
 *   - 8 data-testids preserved verbatim for E2E + future component tests.
 *
 * Extraction-only — zero behaviour change. tsc + vitest preserved
 * byte-for-byte (no new tests this turn either; behaviour is locked by
 * the existing RelatedFunctionsMenu test that asserts
 * `?tab=variance` link presence + the page.tsx tab switch wiring).
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import {
  Loader2,
  BarChart2,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
} from "lucide-react"
import { useBudgetPlans, useBudgetAnalytics } from "@/lib/budgeting/hooks"
import { fmtK } from "@/lib/budget-chart-theme"

const VARIANCE_BAND_RED_PCT = 10
const VARIANCE_BAND_AMBER_PCT = 5

function varianceBand(absPct: number): "red" | "amber" | "green" {
  if (absPct >= VARIANCE_BAND_RED_PCT) return "red"
  if (absPct >= VARIANCE_BAND_AMBER_PCT) return "amber"
  return "green"
}

const VARIANCE_BAND_CLASS: Record<"red" | "amber" | "green", string> = {
  red: "border-l-4 border-l-red-500 bg-red-50 dark:bg-red-950/20",
  amber: "border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-950/20",
  green: "border-l-4 border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/20",
}

const VARIANCE_BAND_TEXT: Record<"red" | "amber" | "green", string> = {
  red: "text-red-700 dark:text-red-400",
  amber: "text-amber-700 dark:text-amber-400",
  green: "text-emerald-700 dark:text-emerald-400",
}

export function VarianceTab() {
  const t = useTranslations("budgeting")
  const { data: plans = [], isLoading: plansLoading } = useBudgetPlans()
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [materialityPct, setMaterialityPct] = useState(5)
  const [showAll, setShowAll] = useState(true)
  const [sortMode, setSortMode] = useState<"variance-pct-desc" | "variance-abs-desc" | "category-asc">(
    "variance-pct-desc",
  )
  const { data: analytics, isLoading: analyticsLoading } = useBudgetAnalytics(
    selectedPlanId ?? "",
  )

  if (plansLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
      </div>
    )
  }

  if (plans.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <BarChart2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
        <p className="font-medium">{t("varianceEmptyNoPlans")}</p>
      </div>
    )
  }

  const byCategory = analytics?.byCategory ?? []
  const filtered = byCategory.filter((row) => {
    if (showAll) return true
    return Math.abs(row.variancePct ?? 0) >= materialityPct
  })
  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === "category-asc") return a.category.localeCompare(b.category)
    if (sortMode === "variance-abs-desc") return Math.abs(b.variance) - Math.abs(a.variance)
    return Math.abs(b.variancePct ?? 0) - Math.abs(a.variancePct ?? 0)
  })

  const overBudgetCount = byCategory.filter(
    (r) => Math.abs(r.variancePct ?? 0) >= VARIANCE_BAND_RED_PCT,
  ).length
  const totalPlanned = analytics?.totalPlanned ?? 0
  const totalActual = analytics?.totalActual ?? 0
  const totalVariance = analytics?.totalVariance ?? 0
  const totalVariancePct = totalPlanned > 0 ? (totalVariance / totalPlanned) * 100 : 0
  const executionPct = analytics?.executionPct ?? 0

  return (
    <div className="space-y-6" data-testid="variance-tab">
      {/* Plan picker — radio-style cards (single-select; differs from
          Comparison's multi-select). */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          {t("varianceSelectPlanTitle")}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {plans.map((p) => {
            const isSelected = p.id === selectedPlanId
            return (
              <button
                key={p.id}
                type="button"
                data-testid={`variance-plan-${p.id}`}
                onClick={() => setSelectedPlanId(p.id)}
                className={`relative rounded-xl p-4 text-left transition-all duration-200 border-2 ${
                  isSelected
                    ? "shadow-lg scale-[1.02] border-purple-500 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/30 dark:to-purple-900/20"
                    : "shadow-sm hover:shadow-md hover:scale-[1.01] border-transparent bg-card text-card-foreground"
                }`}
              >
                {isSelected && (
                  <div className="absolute top-2 right-2">
                    <CheckCircle className="h-4 w-4 text-purple-600" />
                  </div>
                )}
                <div
                  className={`text-xs font-semibold uppercase tracking-wider mb-1 ${
                    isSelected ? "text-purple-700 dark:text-purple-300" : "opacity-50"
                  }`}
                >
                  {p.year}
                </div>
                <div
                  className={`text-sm font-bold truncate ${
                    isSelected ? "text-purple-700 dark:text-purple-300" : ""
                  }`}
                >
                  {p.name}
                </div>
                <div className="text-[10px] mt-1 text-muted-foreground">
                  {p.periodType === "annual"
                    ? t("periodAnnual")
                    : p.periodType === "quarterly"
                    ? t("periodQuarterly", { n: p.quarter ?? 0 })
                    : t("periodMonthly", { n: p.month ?? 0 })}
                  {p.status && ` · ${p.status}`}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Plan-level KPIs — only when plan selected + data loaded. */}
      {selectedPlanId && analyticsLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
        </div>
      )}

      {selectedPlanId && !analyticsLoading && analytics && (
        <>
          <div
            className="grid grid-cols-2 md:grid-cols-5 gap-3"
            data-testid="variance-kpi-strip"
          >
            <div className="rounded-xl border bg-card p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                {t("variancePlannedLabel")}
              </div>
              <div className="text-xl font-bold tabular-nums">
                {fmtK(totalPlanned)} ₼
              </div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                {t("varianceActualLabel")}
              </div>
              <div className="text-xl font-bold tabular-nums">
                {fmtK(totalActual)} ₼
              </div>
            </div>
            <div className={`rounded-xl border bg-card p-4 ${VARIANCE_BAND_CLASS[varianceBand(Math.abs(totalVariancePct))]}`}>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                {t("varianceTotalLabel")}
              </div>
              <div
                className={`text-xl font-bold tabular-nums ${VARIANCE_BAND_TEXT[varianceBand(Math.abs(totalVariancePct))]}`}
              >
                {totalVariance >= 0 ? "+" : ""}
                {fmtK(totalVariance)} ₼
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {totalVariance >= 0 ? "+" : ""}
                {totalVariancePct.toFixed(1)}%
              </div>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                {t("varianceExecutionLabel")}
              </div>
              <div className="text-xl font-bold tabular-nums">{executionPct.toFixed(1)}%</div>
            </div>
            <div
              className={`rounded-xl border bg-card p-4 ${overBudgetCount > 0 ? "border-red-300 dark:border-red-700" : ""}`}
              data-testid="variance-over-budget-count"
            >
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                {t("varianceOverBudgetLabel")}
              </div>
              <div
                className={`text-xl font-bold tabular-nums ${overBudgetCount > 0 ? "text-red-600" : "text-muted-foreground"}`}
              >
                {overBudgetCount}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {t("varianceOverBudgetSub", { threshold: VARIANCE_BAND_RED_PCT })}
              </div>
            </div>
          </div>

          {/* Filter + sort controls. */}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-lg border bg-muted/30">
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                data-testid="variance-show-all"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                className="rounded border-gray-300"
              />
              {t("varianceShowAllLabel")}
            </label>
            {!showAll && (
              <label className="flex items-center gap-2 text-xs font-medium">
                {t("varianceMaterialityLabel")}
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={materialityPct}
                  onChange={(e) => setMaterialityPct(Number(e.target.value))}
                  className="w-16 rounded border-gray-300 px-2 py-1 text-xs tabular-nums"
                />
                %
              </label>
            )}
            <div className="flex items-center gap-2 text-xs font-medium ml-auto">
              {t("varianceSortLabel")}
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
                data-testid="variance-sort"
                className="rounded border-gray-300 px-2 py-1 text-xs"
              >
                <option value="variance-pct-desc">{t("varianceSortByPctDesc")}</option>
                <option value="variance-abs-desc">{t("varianceSortByAbsDesc")}</option>
                <option value="category-asc">{t("varianceSortByCategory")}</option>
              </select>
            </div>
          </div>

          {/* Variance table. */}
          {sorted.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground" data-testid="variance-empty">
              <BarChart2 className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">{t("varianceEmptyAtThreshold", { threshold: materialityPct })}</p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full text-sm" data-testid="variance-table">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">{t("varianceColCategory")}</th>
                    <th className="text-right px-4 py-2 font-semibold">{t("varianceColPlanned")}</th>
                    <th className="text-right px-4 py-2 font-semibold">{t("varianceColActual")}</th>
                    <th className="text-right px-4 py-2 font-semibold">{t("varianceColVariance")}</th>
                    <th className="text-right px-4 py-2 font-semibold">{t("varianceColPct")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => {
                    const absPct = Math.abs(row.variancePct ?? 0)
                    const band = varianceBand(absPct)
                    const sign = row.variance >= 0 ? "+" : ""
                    // Phase 7.G Turn LXII a11y supplement (audit M1 closure):
                    // color-only severity is invisible to color-blind users + screen
                    // readers. Icon prepended to category cell + aria-label on the
                    // row carries the severity verbally.
                    const SeverityIcon =
                      band === "red"
                        ? AlertTriangle
                        : band === "amber"
                        ? AlertCircle
                        : CheckCircle2
                    const severityLabel = t(
                      band === "red"
                        ? "varianceSeverityRed"
                        : band === "amber"
                        ? "varianceSeverityAmber"
                        : "varianceSeverityGreen",
                    )
                    return (
                      <tr
                        key={row.category}
                        data-testid={`variance-row-${row.category}`}
                        data-band={band}
                        aria-label={t("varianceRowAriaLabel", {
                          category: row.category,
                          severity: severityLabel,
                        })}
                        className={`${VARIANCE_BAND_CLASS[band]} border-b last:border-b-0`}
                      >
                        <td className="px-4 py-2 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <SeverityIcon
                              size={14}
                              aria-hidden="true"
                              className={VARIANCE_BAND_TEXT[band]}
                            />
                            {row.category}
                          </span>
                        </td>
                        <td className="text-right px-4 py-2 tabular-nums">
                          {fmtK(row.planned)} ₼
                        </td>
                        <td className="text-right px-4 py-2 tabular-nums">
                          {fmtK(row.actual)} ₼
                        </td>
                        <td className={`text-right px-4 py-2 tabular-nums font-semibold ${VARIANCE_BAND_TEXT[band]}`}>
                          {sign}
                          {fmtK(row.variance)} ₼
                        </td>
                        <td className={`text-right px-4 py-2 tabular-nums font-semibold ${VARIANCE_BAND_TEXT[band]}`}>
                          {sign}
                          {(row.variancePct ?? 0).toFixed(1)}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!selectedPlanId && (
        <div className="text-center py-16 text-muted-foreground" data-testid="variance-pick-plan-hint">
          <p className="text-sm">{t("variancePickPlanHint")}</p>
        </div>
      )}
    </div>
  )
}
