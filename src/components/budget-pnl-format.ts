/**
 * P&L view number / variance formatters — extracted from budget-pnl-view.tsx
 * (Phase 8 D1 2026-05-29) to bring it under the 1000-LOC mega-file line. Pure
 * (no imports); budget-pnl-view imports them back.
 */

export function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toFixed(0)
}

export function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

/**
 * % of revenue for a single cost amount. Returns an empty string when the
 * denominator is zero or the amount is zero — we don't want "0.0%" clutter.
 */
export function pctOfRev(amount: number, rev: number): string {
  if (!rev || !amount) return ""
  return ((Math.abs(amount) / Math.abs(rev)) * 100).toFixed(1) + "%"
}

/**
 * Plan-vs-actual variance % as a signed string. Returns "—" when plan is zero
 * (ratio is undefined). `favorable` decides the colour: for revenue "up" is
 * good (actual > plan outperforms), for costs "down" is good (actual < plan
 * means we spent less than budgeted).
 */
export function varianceStr(actual: number, plan: number): string {
  if (!plan) return "—"
  const delta = ((actual - plan) / plan) * 100
  return (delta >= 0 ? "+" : "") + delta.toFixed(1) + "%"
}

export function varianceClass(actual: number, plan: number, favorable: "up" | "down"): string {
  if (!plan || actual === plan) return "text-muted-foreground"
  const positive = actual > plan
  const good = favorable === "up" ? positive : !positive
  return good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
}
