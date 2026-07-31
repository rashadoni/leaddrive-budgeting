"use client"

/**
 * Phase 3.3 — P&L row drill-down side panel.
 *
 * Click any row in BudgetPnlView → this panel slides in from the right
 * with that account's 12-month plan vs actual vs variance breakdown.
 * Closes via the × button OR Escape OR backdrop click.
 *
 * Pure presentational — accepts the row + actuals via props, owns no
 * data-fetching. The parent (BudgetPnlView) already has the data
 * loaded for the table; we just slice the row out and render it
 * differently.
 */

import { useEffect } from "react"
import { X } from "lucide-react"
import { useTranslations } from "next-intl"
// Phase 3.3 v1.2 — pure variance helpers extracted to a shared module
// so the math is unit-testable and reusable. See variance-helpers.ts
// for the rationale + 12 unit tests covering normal / edge / combined
// cases (favorable-sign × variance.abs).
import { variance, favorableSign } from "@/lib/budgeting/variance-helpers"

/**
 * Phase 3.3 v1.4 — DrillRow widened to accept any PnlRow superset.
 * BudgetPnlView's `PnlRow` carries an extra `parentCode` field that
 * the drill panel doesn't read; we tolerate it via optional. Keeps
 * the panel's prop type loose enough for both callers without losing
 * the 5-field contract.
 */
export interface DrillRow {
  accountCode: string
  accountName: string
  accountType: string
  monthly: Record<number, number>
  total: number
  parentCode?: string | null
}

interface Props {
  row: DrillRow
  actualMonthly?: Record<number, number>
  monthlyRevenue?: Record<number, number>
  onClose: () => void
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "—"
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Math.round(n))
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`
}


export function BudgetPnlDrillPanel({
  row,
  actualMonthly,
  monthlyRevenue,
  onClose,
}: Props) {
  const t = useTranslations("budgeting")
  // Month labels follow the viewer's locale. Until 2026-07-31 this panel
  // hardcoded Russian abbreviations, so an Azerbaijani session saw Russian
  // months next to English headers.
  const months = t("monthsShort").split(",")
  // ESC key closes the panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const plannedTotal = row.total
  const actualTotal = Object.values(actualMonthly ?? {}).reduce(
    (s, v) => s + (v || 0),
    0,
  )
  const totalVariance = variance(plannedTotal, actualTotal)
  // Phase 3.3 v1.2 — direction sign so under-spent expense rows render
  // green ("saved money") instead of red ("under-realized"). Revenue
  // accounts keep the literal sign (higher actual = green).
  const sign = favorableSign(row.accountType)
  const favorableTotalAbs = totalVariance.abs * sign
  // Phase 3.3 v1.3 — distinguish "no actuals entered yet" from a real
  // -100% miss. When actualMonthly is empty / all-zero AND planned > 0,
  // the literal variance "−plannedTotal (−100%)" reads as a catastrophic
  // gap when really the user just hasn't recorded actuals. Show a soft
  // "no actuals yet" placeholder instead so the Δ cell doesn't scream.
  const hasAnyActual =
    actualMonthly != null && Object.values(actualMonthly).some((v) => (v || 0) !== 0)

  return (
    <>
      {/* Backdrop — click to close */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
        data-testid="pnl-drill-backdrop"
      />
      <aside
        role="dialog"
        aria-label={t("drillPanelAria", { account: row.accountName })}
        data-testid="pnl-drill-panel"
        className="fixed right-0 top-0 z-50 h-screen w-full max-w-md overflow-y-auto bg-card border-l border-border shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between bg-card border-b border-border px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("drillAccountEyebrow", { type: row.accountType })}
            </div>
            <div
              className="text-lg font-semibold truncate"
              // Phase 3.3 — hover reveals fully-qualified identifier
              // even when the name truncates.
              title={`${row.accountCode} — ${row.accountName}`}
            >
              {row.accountName}
            </div>
            <div className="text-[11px] font-mono text-muted-foreground">
              {row.accountCode}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("drillCloseAria")}
            className="rounded p-1 hover:bg-muted"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Summary card */}
        <div className="grid grid-cols-3 gap-2 px-4 py-4 border-b border-border">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("colPlan")}
            </div>
            <div className="text-base font-semibold tabular-nums mt-1">
              {fmtMoney(plannedTotal)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("colActual")}
            </div>
            <div className="text-base font-semibold tabular-nums mt-1">
              {fmtMoney(actualTotal)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Δ
            </div>
            {hasAnyActual ? (
              <>
                <div
                  className={`text-base font-semibold tabular-nums mt-1 ${
                    favorableTotalAbs > 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : favorableTotalAbs < 0
                      ? "text-red-700 dark:text-red-400"
                      : ""
                  }`}
                >
                  {fmtMoney(totalVariance.abs)}
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {fmtPct(totalVariance.pct * sign)}
                </div>
              </>
            ) : (
              // Phase 3.3 v1.3 — soft empty state. No actuals recorded yet,
              // so the "Δ = -plannedTotal (-100%)" computation reads as a
              // false alarm. Show a muted placeholder instead.
              <div
                className="text-xs text-muted-foreground/70 mt-1.5 italic"
                data-testid="pnl-drill-empty-actuals"
              >
                {t("drillNoActualsYet")}
              </div>
            )}
          </div>
        </div>

        {/* Monthly breakdown table */}
        <div className="px-2 py-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 px-2">
            {t("drillMonthlyBreakdown")}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2 text-left">{t("colMonth")}</th>
                <th className="px-2 py-2 text-right">{t("colPlan")}</th>
                <th className="px-2 py-2 text-right">{t("colActual")}</th>
                <th className="px-2 py-2 text-right">Δ</th>
                <th className="px-2 py-2 text-right">{t("drillColPctRevenue")}</th>
              </tr>
            </thead>
            <tbody data-testid="pnl-drill-monthly-tbody">
              {Array.from({ length: 12 }, (_, i) => {
                const month = i + 1
                const plan = row.monthly[month] ?? 0
                const actual = actualMonthly?.[month] ?? 0
                const v = variance(plan, actual)
                const monthRev = monthlyRevenue?.[month] ?? 0
                const pctRev = monthRev > 0 ? (Math.abs(plan) / monthRev) * 100 : null
                return (
                  <tr
                    key={month}
                    className="border-b border-border/60 hover:bg-muted/30"
                    data-month={month}
                  >
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {months[i]}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtMoney(plan)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtMoney(actual)}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        v.abs * sign > 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : v.abs * sign < 0
                          ? "text-red-700 dark:text-red-400"
                          : "text-muted-foreground/60"
                      }`}
                    >
                      {fmtMoney(v.abs)}
                    </td>
                    <td className="px-2 py-1.5 text-right text-[10px] text-muted-foreground tabular-nums">
                      {pctRev != null ? `${pctRev.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="px-2 py-2">{t("totalLabel")}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtMoney(plannedTotal)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtMoney(actualTotal)}
                </td>
                <td
                  className={`px-2 py-2 text-right tabular-nums ${
                    favorableTotalAbs > 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : favorableTotalAbs < 0
                      ? "text-red-700 dark:text-red-400"
                      : ""
                  }`}
                >
                  {fmtMoney(totalVariance.abs)}
                </td>
                <td className="px-2 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Hint */}
        <div className="px-4 pb-4 pt-2 text-[10px] text-muted-foreground">
          {t.rich("drillCloseHint", {
            kbd: (chunks) => <kbd className="border rounded px-1 font-mono">{chunks}</kbd>,
          })}
        </div>
      </aside>
    </>
  )
}
