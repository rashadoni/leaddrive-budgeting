/**
 * P&L rows → section totals, for a chosen set of months (2026-08-19).
 *
 * Extracted so the year-end landing can build the same buckets the P&L builds,
 * over an arbitrary month window, without re-deriving the classification and
 * without depending on the shape of the P&L route's response payload.
 *
 * That dependency is what this exists to remove. The first version of the
 * year-end screen read budget opex from the top level of that payload, where
 * only revenue, COGS and other-operating live — the rest sit under
 * `comparison.budget`. Budget costs silently read as zero and the screen
 * reported an EBITDA gap of −5.7M where the P&L showed +888k for the same
 * months. Classification is deterministic; payload archaeology is not.
 *
 * Pure: the caller supplies rows and injects the canonical classifiers, so
 * this file cannot drift from them and can be tested without importing the
 * chart-of-accounts machinery.
 */
import type { PnlSectionTotals } from "./ebitda"

export interface ClassifiableRow {
  code: string
  accountType: string | null
  /** 1-based calendar month. */
  month: number
  amount: number
}

export interface SectionClassifiers {
  section: (code: string, accountType: string | null) => string | null
  /** Signed revenue contribution — contra-revenue subtracts. */
  revenue: (code: string, amount: number) => number
  /** Signed other-operating contribution — income-positive. */
  otherOperating: (code: string, amount: number) => number
  isDa: (code: string) => boolean
}

export function sectionTotalsFromRows(
  rows: ReadonlyArray<ClassifiableRow>,
  months: ReadonlyArray<number>,
  c: SectionClassifiers,
): PnlSectionTotals {
  const wanted = new Set(months)
  const t: PnlSectionTotals = {
    totalRevenue: 0,
    totalCogs: 0,
    totalOpex: 0,
    totalOtherOperating: 0,
    totalBelowEbitda: 0,
    daInCogs: 0,
    daInOpex: 0,
  }

  for (const row of rows) {
    if (!wanted.has(row.month)) continue
    switch (c.section(row.code, row.accountType)) {
      case "revenue":
        t.totalRevenue += c.revenue(row.code, row.amount)
        break
      case "cogs":
        // Cost-positive here, unlike the P&L view which negates for display.
        t.totalCogs += row.amount
        if (c.isDa(row.code)) t.daInCogs += row.amount
        break
      case "opex":
        t.totalOpex += row.amount
        if (c.isDa(row.code)) t.daInOpex += row.amount
        break
      case "otherOperating":
        t.totalOtherOperating = (t.totalOtherOperating ?? 0) + c.otherOperating(row.code, row.amount)
        break
      case "belowEbitda":
        t.totalBelowEbitda += row.amount
        break
      // null — the sheet's own subtotal rows and anything that aggregates into
      // no P&L line. Counting them would double every section they summarise.
      default:
        break
    }
  }

  return t
}
