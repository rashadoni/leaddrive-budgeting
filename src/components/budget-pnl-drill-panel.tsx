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

const MONTHS_RU = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
]

export interface DrillRow {
  accountCode: string
  accountName: string
  accountType: string
  monthly: Record<number, number>
  total: number
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

function variance(plan: number, actual: number): { abs: number; pct: number } {
  const abs = actual - plan
  const pct = plan === 0 ? (actual === 0 ? 0 : 100) : (abs / Math.abs(plan)) * 100
  return { abs, pct }
}

/**
 * Phase 3.3 v1.2 — variance sign depends on whether bigger-is-better.
 * For revenue accounts (favorable="up"), positive abs (overshooting plan)
 * is GREEN. For expense / cogs / opex (favorable="down"), positive abs
 * (overspending) is RED — so under-spent expense rows correctly read as
 * green ("we saved money"), not red ("we under-realized"). Returns the
 * direction sign — multiply variance.abs by this before the green/red
 * threshold check.
 */
function favorableSign(accountType: string): 1 | -1 {
  return accountType === "revenue" ? 1 : -1
}

export function BudgetPnlDrillPanel({
  row,
  actualMonthly,
  monthlyRevenue,
  onClose,
}: Props) {
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
        aria-label={`Detail for ${row.accountName}`}
        data-testid="pnl-drill-panel"
        className="fixed right-0 top-0 z-50 h-screen w-full max-w-md overflow-y-auto bg-card border-l border-border shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between bg-card border-b border-border px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Account · {row.accountType}
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
            aria-label="Close detail panel"
            className="rounded p-1 hover:bg-muted"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Summary card */}
        <div className="grid grid-cols-3 gap-2 px-4 py-4 border-b border-border">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Plan
            </div>
            <div className="text-base font-semibold tabular-nums mt-1">
              {fmtMoney(plannedTotal)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Actual
            </div>
            <div className="text-base font-semibold tabular-nums mt-1">
              {fmtMoney(actualTotal)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Δ
            </div>
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
          </div>
        </div>

        {/* Monthly breakdown table */}
        <div className="px-2 py-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 px-2">
            12-month breakdown · plan / actual / Δ
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-2 text-left">Month</th>
                <th className="px-2 py-2 text-right">Plan</th>
                <th className="px-2 py-2 text-right">Actual</th>
                <th className="px-2 py-2 text-right">Δ</th>
                <th className="px-2 py-2 text-right">% rev</th>
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
                      {MONTHS_RU[i]}
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
                <td className="px-2 py-2">Total</td>
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
          Press <kbd className="border rounded px-1 font-mono">Esc</kbd> or click
          outside to close.
        </div>
      </aside>
    </>
  )
}
