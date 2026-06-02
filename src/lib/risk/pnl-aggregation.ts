/**
 * Pure P&L aggregation over budget/actual financial lines.
 *
 * Single source of truth shared by:
 *   - `budgetLineResolver` (the Risk Terminal's P&L computation), and
 *   - the period-fact deriver (Phase 1 of the terminal-PnL/budget decoupling),
 * so derived `pl_*` OperationalFacts are BIT-PERFECT vs what the terminal
 * computes today. Extracted verbatim from the loop formerly inlined in
 * `budgetLineResolver` (recompute-resolvers-b.ts) — behavior must not change.
 */
import { isDaCode } from "../budgeting/da-codes"

export interface PnlLineInput {
  plannedAmount: number
  currencyCode: string | null
  exchangeRate: number | null
  /** account.accountType ?? lineType — "revenue" | "cogs" | "expense" | ... */
  accountType: string | null
  accountCode: string | null
}

export interface PnlAggregates {
  revenue: number
  cogs: number
  opex: number
  imported_cogs: number
  domestic_cogs: number
  imported_opex: number
  domestic_opex: number
  /** D&A add-back base (SAP codes 703-11 / 721-11), summed as |amount|. */
  da_total: number
  /** Foreign lines skipped because they had no exchange rate. */
  missing_rate_count: number
  total_cost: number
  total_input_cost: number
  imported_input_cost: number
  domestic_input_cost: number
  gross_profit: number
  net_income: number
}

/**
 * Aggregate P&L lines into the terminal's financial context values.
 * `baseCurrency` = the company's base currency; a line tagged with it (or with
 * a null currency) is treated as base, never foreign. Foreign lines without an
 * exchange rate are skipped (counted in `missing_rate_count`) rather than
 * assumed 1:1, exactly as the resolver does.
 */
export function aggregatePnlLines(
  lines: ReadonlyArray<PnlLineInput>,
  baseCurrency: string | null | undefined,
): PnlAggregates {
  let revenue = 0
  let cogs = 0
  let opex = 0
  let imported_cogs = 0
  let domestic_cogs = 0
  let imported_opex = 0
  let domestic_opex = 0
  let missing_rate_count = 0
  let da_total = 0

  for (const l of lines) {
    const isForeign = l.currencyCode != null && l.currencyCode !== baseCurrency
    if (isForeign && l.exchangeRate == null) {
      missing_rate_count += 1
      continue
    }
    const rate = l.exchangeRate ?? 1
    const amountBase = isForeign ? l.plannedAmount * rate : l.plannedAmount

    const type = l.accountType
    if (type === "revenue") {
      revenue += amountBase
    } else if (type === "cogs") {
      cogs += amountBase
      if (isForeign) imported_cogs += amountBase
      else domestic_cogs += amountBase
    } else if (type === "expense") {
      opex += amountBase
      if (isForeign) imported_opex += amountBase
      else domestic_opex += amountBase
    }
    if (l.accountCode != null && isDaCode(l.accountCode)) {
      da_total += Math.abs(amountBase)
    }
  }

  return {
    revenue,
    cogs,
    opex,
    imported_cogs,
    domestic_cogs,
    imported_opex,
    domestic_opex,
    da_total,
    missing_rate_count,
    total_cost: cogs + opex,
    total_input_cost: cogs,
    imported_input_cost: imported_cogs,
    domestic_input_cost: domestic_cogs,
    gross_profit: revenue - cogs,
    net_income: revenue - cogs - opex,
  }
}
