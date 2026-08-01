/**
 * Phase 7.G Turn LXXV (Phase 5.1 — ChartOfAccount.role refactor).
 *
 * Single source of truth for SAP code-prefix → role classification.
 * Was hardcoded inline in 2 routes (`import-excel/route.ts` ingest +
 * `pnl/route.ts` consumer); each had subtle drift (import-excel folded
 * 602/603 into "revenue", pnl folded them into "revenue" but flipped
 * sign as contra-revenue, etc). Centralizing the rule prevents new
 * drift + lets future per-org `chartOfAccount.role` overrides ride on
 * the same column.
 *
 * Roles (P&L bucket semantics):
 *   - `revenue`        — top-line (601, 611) + contra-revenue (602, 603)
 *                        treated as revenue with negative sign convention
 *                        documented at consumer layer
 *   - `cogs`           — cost of goods sold (701)
 *   - `opex`           — operating expenses (711, 721)
 *   - `finance`        — finance costs / interest (731)
 *   - `tax_costs`      — pre-EBIT tax-classed costs (741)
 *   - `non_operating`  — non-operating income/expense (751, 761, 771)
 *   - `tax`            — corporate income tax (801)
 *   - `unknown`        — code doesn't match any prefix (caller decides
 *                        fallback — e.g. classify as "expense")
 *
 * Why a NEW field (not extending `accountType`):
 *   - `accountType` today is "revenue|expense|cogs|asset|liability|equity"
 *     — coarse and load-bearing for many existing consumers (would break
 *     on enum change).
 *   - `role` is finer-grained P&L-bucket-specific, additive, and lets the
 *     legacy column stay untouched.
 *
 * Per-org override path: when 2nd customer has a non-AAC chart, admin
 * can override `chartOfAccount.role` per row via Settings UI (future
 * Phase 5.1 sub-2 — not shipped this turn). The deriveRoleFromCode
 * default below is the AAC-specific fallback.
 */

import { plfNature } from "./plf-chart"

export type CoARole =
  | "revenue"
  | "cogs"
  | "opex"
  | "finance"
  | "tax_costs"
  | "non_operating"
  | "tax"
  | "unknown"

/**
 * Derive the canonical role from a SAP-style account code. Uses
 * AAC-specific prefixes as the default classification rule. Returns
 * `"unknown"` for anything that doesn't match — callers should treat
 * unknown as "out of P&L scope" (e.g. balance-sheet codes).
 *
 * Phase 5.1 follow-up: when per-org override lands, route through:
 *   `account.role ?? deriveRoleFromCode(account.code)`
 * Existing consumers should NOT inline-call this helper; they should
 * read `chartOfAccount.role` (which the import-excel route stamps at
 * insert-time using this helper).
 */
export function deriveRoleFromCode(code: string): CoARole {
  if (!code || typeof code !== "string") return "unknown"
  const c = code.trim()
  if (!c) return "unknown"

  if (c.startsWith("601") || c.startsWith("611")) return "revenue"
  if (c.startsWith("602") || c.startsWith("603")) return "revenue" // contra-revenue
  if (c.startsWith("701")) return "cogs"
  if (c.startsWith("711") || c.startsWith("721")) return "opex"
  if (c.startsWith("731")) return "finance"
  if (c.startsWith("741")) return "tax_costs"
  if (c.startsWith("751") || c.startsWith("761") || c.startsWith("771")) return "non_operating"
  if (c.startsWith("801")) return "tax"
  return "unknown"
}

/**
 * Classifies a code as contra-revenue (602/603) — these need
 * sign-flip in P&L aggregation. Separate predicate because
 * `deriveRoleFromCode` returns "revenue" for both 601 (positive)
 * and 602 (negative); consumers that need to flip sign use this.
 */
export function isContraRevenueCode(code: string): boolean {
  if (!code || typeof code !== "string") return false
  const c = code.trim()
  return c.startsWith("602") || c.startsWith("603")
}

/**
 * P&L-section mapper — coarser than `CoARole`, used by P&L aggregation.
 * Returns `null` for codes that don't aggregate into any P&L line (asset,
 * liability, equity, unknown, and the sheet's own subtotal rows).
 *
 * `otherOperating` is "other operating income/(expense)": ABOVE EBITDA and
 * OUTSIDE revenue and gross profit. It is the only SIGNED bucket — its total
 * is income-positive, where `cogs` / `opex` / `belowEbitda` are all
 * cost-positive magnitudes. Use `otherOperatingContribution` to add a row to
 * it; do not sum raw amounts.
 */
export type PnLSection =
  | "revenue"
  | "cogs"
  | "opex"
  | "otherOperating"
  | "belowEbitda"
  | null

export function pnlSectionFromRole(role: CoARole): PnLSection {
  switch (role) {
    case "revenue":
      return "revenue"
    case "cogs":
      return "cogs"
    case "opex":
      return "opex"
    case "finance":
    case "tax_costs":
    case "non_operating":
    case "tax":
      return "belowEbitda"
    case "unknown":
      return null
  }
}

/**
 * P&L-section mapper for imported account codes.
 *
 * `deriveRoleFromCode` intentionally stays SAP/AAC-specific. The AI import can
 * also persist customer workbook codes such as `PLF.01.02.01`; reporting must
 * understand those codes directly, otherwise Actual-vs-Budget silently drops
 * revenue/COGS and mislabels below-EBITDA rows as OpEx.
 *
 * The PLF branch delegates to `plf-chart.ts` — the same statement the importer
 * classifies from — so the two can no longer disagree. They did: it used to
 * route `PLF.07.01/.02` (other-operating income) into REVENUE to compensate
 * for the importer storing it negative, and return `null` for `PLF.08.01`
 * (Shareholders' expense, 174,491 AZN) which the importer deliberately wrote.
 */
export function pnlSectionFromCode(
  code: string,
  accountType?: string | null,
): PnLSection {
  const sapSection = pnlSectionFromRole(deriveRoleFromCode(code))
  if (sapSection) return sapSection

  switch (plfNature(code)) {
    case "revenue":
      return "revenue"
    case "cogs":
      return "cogs"
    case "opex":
      return "opex"
    case "other_operating_income":
    case "other_operating_expense":
      return "otherOperating"
    case "below_ebitda":
      return "belowEbitda"
    case "subtotal":
      return null
    case null:
      break
  }

  if (accountType === "revenue") return "revenue"
  if (accountType === "cogs") return "cogs"
  if (accountType === "expense") return "opex"
  return null
}

/**
 * Signed contribution of a row to the "other operating income/(expense)"
 * line. Income positive; an expense row (stored cost-positive) subtracts.
 *
 * Re-exported from `plf-chart.ts` so every reporting surface reaches the
 * bucket's sign rule through the same import as its section rule.
 */
export { plfOtherOperatingContribution as otherOperatingContribution } from "./plf-chart"

/**
 * Signed revenue contribution of a P&L row whose section is `revenue`.
 *
 * This used to take the row's **BudgetLine.lineType** and flip the amount
 * whenever it was not `"revenue"`. That parameter existed for exactly one
 * reason: `PLF.07.01/.02` other-operating income was stored NEGATIVE under
 * the expense convention while `pnlSectionFromCode` routed it into revenue,
 * so the sign had to be undone here. Both halves of that compensation are
 * gone — the importer now stores income positive and the section mapper puts
 * it in `otherOperating` — and a compensator with nothing left to compensate
 * is just a way to silently negate the next row that trips it.
 *
 * What remains is the rule that was always real: contra-revenue (returns /
 * discounts, SAP 602/603) subtracts from the top line.
 */
export function revenueContribution(code: string, amount: number): number {
  return isContraRevenueCode(code) ? -amount : amount
}
