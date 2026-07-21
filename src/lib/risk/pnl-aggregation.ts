/**
 * Pure P&L aggregation over budget/actual financial lines.
 *
 * Single source of truth shared by:
 *   - `budgetLineResolver` (the Risk Terminal's P&L computation), and
 *   - the period-fact deriver (Phase 1 of the terminal-PnL/budget decoupling),
 * so derived `pl_*` OperationalFacts are BIT-PERFECT vs what the terminal
 * computes today. Revenue and section signs deliberately reuse the canonical
 * P&L helpers so reporting and risk calculations cannot drift independently.
 */
import { isDaCode } from "../budgeting/da-codes"
import { pnlSectionFromCode, revenueContribution } from "../budgeting/coa-role"

export interface PnlLineInput {
  /**
   * Canonical reported/base amount. Foreign source amounts are retained below
   * as provenance; they are never converted a second time during read-side
   * aggregation.
   */
  plannedAmount: number
  /** Original source-currency amount for a foreign line, when evidenced. */
  originalAmount?: number | null
  currencyCode: string | null
  /** Source conversion evidence retained with the line; not a read-side multiplier. */
  exchangeRate: number | null
  /** account.accountType ?? lineType — "revenue" | "cogs" | "expense" | ... */
  accountType: string | null
  /** BudgetLine.lineType: the convention used when the importer stored signs. */
  lineType?: string | null
  accountCode: string | null
  monthIndex?: number | null
}

export interface PnlAggregates {
  revenue: number
  cogs: number
  opex: number
  /** Finance, tax and other rows below operating EBITDA. */
  below_ebitda: number
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
 * A null currency is legacy/base data. A base-currency tag is likewise base
 * data even when it has no exchange-rate evidence. Only an explicit non-base
 * code is foreign and therefore subject to the stricter evidence gate.
 */
export function isForeignCurrencyLine(
  line: Pick<PnlLineInput, "currencyCode">,
  baseCurrency: string | null | undefined,
): boolean {
  return line.currencyCode != null && line.currencyCode !== baseCurrency
}

/** A source conversion rate is usable only when finite and strictly positive. */
export function isValidExchangeRate(
  exchangeRate: number | null | undefined,
): exchangeRate is number {
  return (
    typeof exchangeRate === "number" &&
    Number.isFinite(exchangeRate) &&
    exchangeRate > 0
  )
}

/**
 * Aggregate P&L lines into the terminal's financial context values.
 * `baseCurrency` = the company's base currency; a line tagged with it (or with
 * a null currency) is treated as base, never foreign. Foreign lines without an
 * exchange rate are skipped (counted in `missing_rate_count`) rather than
 * assumed 1:1. `plannedAmount` is already the reported/base amount by the
 * BudgetLine contract; `originalAmount` and `exchangeRate` preserve source
 * evidence and must not trigger a second conversion here.
 */
export function aggregatePnlLines(
  lines: ReadonlyArray<PnlLineInput>,
  baseCurrency: string | null | undefined,
): PnlAggregates {
  let revenue = 0
  let cogs = 0
  let opex = 0
  let below_ebitda = 0
  let imported_cogs = 0
  let domestic_cogs = 0
  let imported_opex = 0
  let domestic_opex = 0
  let missing_rate_count = 0
  let da_total = 0

  for (const l of lines) {
    const isForeign = isForeignCurrencyLine(l, baseCurrency)
    if (isForeign && !isValidExchangeRate(l.exchangeRate)) {
      missing_rate_count += 1
      continue
    }
    const amountBase = l.plannedAmount

    const code = l.accountCode ?? ""
    const section = pnlSectionFromCode(code, l.accountType)
    if (section === "revenue") {
      // PLF.07.01/.02 income is linked to a revenue CoA but was stored under
      // the expense sign convention. Use the same canonical normalization as
      // the P&L API; falling back to accountType preserves legacy/SAP rows.
      revenue += revenueContribution(
        code,
        l.lineType ?? l.accountType,
        amountBase,
      )
    } else if (section === "cogs") {
      cogs += amountBase
      if (isForeign) imported_cogs += amountBase
      else domestic_cogs += amountBase
    } else if (section === "opex") {
      opex += amountBase
      if (isForeign) imported_opex += amountBase
      else domestic_opex += amountBase
    } else if (section === "belowEbitda") {
      below_ebitda += amountBase
    }
    if (l.accountCode != null && isDaCode(l.accountCode)) {
      da_total += Math.abs(amountBase)
    }
  }

  return {
    revenue,
    cogs,
    opex,
    below_ebitda,
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
    net_income: revenue - cogs - opex - below_ebitda,
  }
}

/**
 * Month coverage of non-zero operating P&L rows, using the same inclusion and
 * FX rules as aggregatePnlLines. `unattributedLineCount > 0` means the period
 * basis cannot be demonstrated: some contributing rows have no month index.
 */
export function activePnlMonths(
  lines: ReadonlyArray<PnlLineInput>,
  baseCurrency: string | null | undefined,
): { months: number[]; unattributedLineCount: number } {
  const months = new Set<number>()
  let unattributedLineCount = 0

  for (const l of lines) {
    const isForeign = isForeignCurrencyLine(l, baseCurrency)
    if (isForeign && !isValidExchangeRate(l.exchangeRate)) continue
    const amountBase = l.plannedAmount
    if (amountBase === 0) continue

    const section = pnlSectionFromCode(l.accountCode ?? "", l.accountType)
    if (section !== "revenue" && section !== "cogs" && section !== "opex") {
      continue
    }
    if (l.monthIndex == null || l.monthIndex < 0 || l.monthIndex > 11) {
      unattributedLineCount += 1
    } else {
      months.add(l.monthIndex)
    }
  }

  return { months: [...months].sort((a, b) => a - b), unattributedLineCount }
}
