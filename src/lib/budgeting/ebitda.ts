/**
 * Phase 7.H Feature 5 — single source of truth for EBITDA computation.
 *
 * Extracted from inline logic in `src/components/budget-pnl-view.tsx` so the
 * P&L view, the client-reconciliation API, and any future board-deck /
 * forecast surface compute EBITDA identically. Inconsistency here was the
 * exact failure mode the v1 feature aims to surface (Risk Terminal's
 * `IND_EBITDA_MARGIN` resolver doesn't add D&A back — see CARRYOVER row
 * after this turn for the resolver-upgrade follow-up).
 *
 * Canonical formula (AZMADE SAP convention):
 *   EBIT   = Revenue − COGS − OpEx + OtherOperating
 *                                         (D&A still buried inside COGS+OpEx)
 *   D&A    = sum(703-11 lines) + sum(721-11 lines)   (Math.abs both)
 *   EBITDA = EBIT + D&A
 *
 * `OtherOperating` (2026-08-01) is the FO workbook's `PLF.07` section — other
 * operating income/(expense), signed income-positive. It is zero for the SAP
 * chart, which has no such line, so the formula above is unchanged there.
 *
 * Why add D&A back? Naive `Rev − COGS − OpEx` is EBIT, not EBITDA, because
 * COGS+OpEx already have depreciation subtracted via 703-11/721-11 lines.
 * Mislabelling EBIT as EBITDA was the chart bug closed in Turn-38-sub-4.
 */

import { isDaCode } from "./da-codes"
import { otherOperatingContribution, pnlSectionFromCode } from "./coa-role"

/** Already-aggregated P&L section totals (all numbers absolute / cost-as-positive). */
export interface PnlSectionTotals {
  totalRevenue: number
  /** Cost of goods sold, as a positive number. */
  totalCogs: number
  /** Operating expenses (711/721 + unmatched-expense legacy fallback), positive. */
  totalOpex: number
  /**
   * Other operating income/(expense) — `PLF.07.*`. SIGNED, income-positive,
   * unlike every other total here. Sits above EBITDA and outside revenue and
   * gross profit, which is where the client's own `PLF.08` EBITDA row puts it:
   * 20,180,179 gross profit − 17,366,027 opex + 13,076,279 = 15,890,432.
   *
   * Optional so callers that predate the bucket (and charts that have no such
   * line) keep compiling and reading zero.
   */
  totalOtherOperating?: number
  /** Below-EBITDA lines (finance/tax/non-operating/income-tax), positive. */
  totalBelowEbitda: number
  /** D&A buried inside COGS (703-11 codes). */
  daInCogs: number
  /** D&A buried inside OpEx (721-11 codes). */
  daInOpex: number
}

export interface EbitdaBreakdown {
  grossProfit: number
  grossMargin: number
  totalDa: number
  ebit: number
  ebitda: number
  ebitdaMargin: number
  netProfit: number
  netMargin: number
}

/**
 * Pure math: P&L section totals → EBITDA + adjacent metrics.
 * No row classification, no sign-flipping — feed normalized numbers in.
 *
 * Margin is 0% when `totalRevenue <= 0` (avoids div-by-zero and the spurious
 * "−100%" margin a zero-revenue period would otherwise produce).
 */
export function computeEbitda(t: PnlSectionTotals): EbitdaBreakdown {
  const grossProfit = t.totalRevenue - t.totalCogs
  const grossMargin = t.totalRevenue > 0 ? (grossProfit / t.totalRevenue) * 100 : 0
  const totalDa = t.daInOpex + t.daInCogs
  const otherOperating = t.totalOtherOperating ?? 0
  const ebit = grossProfit - t.totalOpex + otherOperating
  const ebitda = ebit + totalDa
  const ebitdaMargin = t.totalRevenue > 0 ? (ebitda / t.totalRevenue) * 100 : 0
  const netProfit = ebit - t.totalBelowEbitda
  const netMargin = t.totalRevenue > 0 ? (netProfit / t.totalRevenue) * 100 : 0
  return { grossProfit, grossMargin, totalDa, ebit, ebitda, ebitdaMargin, netProfit, netMargin }
}

export interface PnlRowForAggregation {
  accountCode: string
  accountType: string
  total: number
}

export interface AggregatedPnl<R extends PnlRowForAggregation> {
  totals: PnlSectionTotals
  /** Operating-expense rows (711/721 + legacy unmatched). */
  opexRows: R[]
  /**
   * Other operating income/(expense) rows — `PLF.07.*`. Both natures, so the
   * income rows here are `accountType: "revenue"` and the expense rows
   * `"expense"`; sum them with `otherOperatingContribution`, never raw.
   */
  otherOperatingRows: R[]
  /** Finance/tax/non-operating rows. */
  belowEbitdaRows: R[]
  /** D&A rows inside OpEx (721-11). */
  daRowsInOpex: R[]
  /** D&A rows inside COGS (703-11). */
  daRowsInCogs: R[]
}

/**
 * Row-classification helper. Filters/groups the rows by P&L section and
 * returns both the totals (ready for `computeEbitda`) and the row buckets
 * (so callers that need per-month detail can iterate them).
 *
 * `totalRevenue` / `totalCogs` are passed in (rather than re-derived from
 * rows) because the API returns them already aggregated per month —
 * recomputing here would duplicate sign-convention logic and risk drift.
 */
export function aggregateRowsForEbitda<R extends PnlRowForAggregation>(args: {
  rows: R[]
  /** Sum of monthly revenue, already sign-corrected (positive). */
  totalRevenue: number
  /** Sum of monthly COGS, already absolute (positive). */
  totalCogs: number
}): AggregatedPnl<R> {
  const allExpenseRows = args.rows.filter(
    (r) => r.accountType === "expense" && r.total !== 0,
  )
  const opexRows = allExpenseRows.filter((r) => {
    return pnlSectionFromCode(r.accountCode, r.accountType) === "opex"
  })
  const belowEbitdaRows = allExpenseRows.filter(
    (r) => pnlSectionFromCode(r.accountCode, r.accountType) === "belowEbitda",
  )
  // NOT filtered to expense-typed rows: the income half of this bucket
  // (subsidies, interest income) is `revenue`-conventioned, and filtering it
  // out is how 13.45M went missing from EBITDA in the first place.
  const otherOperatingRows = args.rows.filter(
    (r) =>
      r.total !== 0 &&
      pnlSectionFromCode(r.accountCode, r.accountType) === "otherOperating",
  )
  const totalOtherOperating = otherOperatingRows.reduce(
    (s, r) => s + otherOperatingContribution(r.accountCode, r.total),
    0,
  )
  const daRowsInOpex = opexRows.filter((r) => isDaCode(r.accountCode))
  const daRowsInCogs = args.rows.filter(
    (r) => r.accountType === "cogs" && r.total !== 0 && isDaCode(r.accountCode),
  )
  const daInOpex = Math.abs(daRowsInOpex.reduce((s, r) => s + r.total, 0))
  const daInCogs = Math.abs(daRowsInCogs.reduce((s, r) => s + r.total, 0))
  const totalOpex = Math.abs(opexRows.reduce((s, r) => s + r.total, 0))
  const totalBelowEbitda = Math.abs(
    belowEbitdaRows.reduce((s, r) => s + r.total, 0),
  )
  return {
    totals: {
      totalRevenue: args.totalRevenue,
      totalCogs: args.totalCogs,
      totalOpex,
      totalOtherOperating,
      totalBelowEbitda,
      daInCogs,
      daInOpex,
    },
    opexRows,
    otherOperatingRows,
    belowEbitdaRows,
    daRowsInOpex,
    daRowsInCogs,
  }
}

/**
 * Actuals path — sectionActuals come pre-aggregated from the P&L route, and
 * D&A in actuals is extracted by scanning `actualByKey` for D&A codes
 * (Math.abs, since actuals can land with either sign convention).
 *
 * D&A is bundled into a single `daInOpex` bucket because the actuals shape
 * doesn't preserve the COGS-vs-OpEx split per account; the math is
 * equivalent (totalDa = daInOpex + daInCogs).
 */
export function computeActualEbitda(args: {
  sectionActuals: {
    revenue: number
    cogs: number
    opex: number
    /** Signed, income-positive. Absent on legacy payloads → 0. */
    otherOperating?: number
    belowEbitda: number
  }
  actualByKey: Record<string, number>
}): EbitdaBreakdown {
  const actualDaTotal = Object.entries(args.actualByKey).reduce(
    (s, [key, value]) => {
      const code = key.split("::")[0]
      return s + (isDaCode(code) ? Math.abs(value) : 0)
    },
    0,
  )
  return computeEbitda({
    totalRevenue: args.sectionActuals.revenue,
    totalCogs: args.sectionActuals.cogs,
    totalOpex: args.sectionActuals.opex,
    totalOtherOperating: args.sectionActuals.otherOperating ?? 0,
    totalBelowEbitda: args.sectionActuals.belowEbitda,
    daInCogs: 0,
    daInOpex: actualDaTotal,
  })
}
