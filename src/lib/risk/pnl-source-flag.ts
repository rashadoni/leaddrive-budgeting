/**
 * Phase 0 (decouple-terminal-pnl plan) — terminal P&L source selector.
 *
 * Controls where the Risk Terminal's financial resolvers read P&L/BS/CF from:
 *   - "budgetline" (DEFAULT): legacy — read BudgetLine.plannedAmount (the budget
 *     plan). This is the current behavior; the flag is a no-op until Phase 2
 *     wires the actuals path, so adding it now changes nothing.
 *   - "actuals": read period-scoped financial facts (the decoupled actuals).
 *   - "dual": compute both, return actuals, log divergence (staging parity check).
 *
 * Set via env `TERMINAL_PNL_SOURCE`. Kept tiny + side-effect-free so it can be
 * imported by the recompute data source without pulling config weight.
 */
export type PnlSource = "budgetline" | "actuals" | "dual"

export function getTerminalPnlSource(): PnlSource {
  const v = (process.env.TERMINAL_PNL_SOURCE ?? "").trim().toLowerCase()
  if (v === "actuals" || v === "dual") return v
  return "budgetline"
}
