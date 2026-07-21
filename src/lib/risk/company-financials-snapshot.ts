/**
 * Phase 7.L — Company financials snapshot helper.
 *
 * Aggregates `budget_lines` per company × period into the simple shape
 * the impact-forecast LLM needs: revenue / COGS / OPEX / EBITDA in AZN.
 *
 * Why budget_lines: it's the authoritative source for company-level
 * financial structure. `IndicatorValue` rows store ratios (margin %,
 * opex_ratio %) but not absolute AZN totals. The LLM needs absolute
 * numbers to compute "X% of COGS = ₼Y" arithmetic that anchors its
 * scenario forecasts.
 *
 * Placeholder handling: DEMO-* companies have no budget_lines → this
 * returns nulls across the board. Downstream forecaster surfaces this
 * as "macro-placeholder, no real financials" with confidence=low.
 */
import type { PrismaClient } from "@prisma/client"
import {
  isForeignCurrencyLine,
  isValidExchangeRate,
} from "./pnl-aggregation"

export interface CompanyFinancialsSnapshot {
  revenueAZN: number | null
  cogsAZN: number | null
  opexAZN: number | null
  ebitdaAZN: number | null
  period: string
}

/**
 * Sum planned amounts grouped by `lineType` for a company × year.
 * Convention used in the codebase:
 *   - lineType='revenue' → revenueAZN
 *   - lineType='cogs' → cogsAZN
 *   - lineType='expense' → opexAZN (non-COGS expenses)
 *   - EBITDA = revenue - cogs - opex (derived)
 *
 * Returns nulls when no budget data exists for that company. Caller
 * decides whether to skip the company or proceed with low-confidence
 * forecast.
 */
export async function getCompanyFinancialsSnapshot(
  prisma: Pick<PrismaClient, "budgetLine">,
  companyId: string,
  year: number,
  organizationId?: string,
): Promise<CompanyFinancialsSnapshot> {
  // Fetch per-line (not groupBy._sum) so the foreign-evidence gate can be
  // applied before summing. `plannedAmount` is already a base-currency amount;
  // foreign source values live in `originalAmount` and are never re-converted.
  const lines = await prisma.budgetLine.findMany({
    where: {
      companyId,
      // Defense-in-depth org scope when the caller supplies it. companyId is a
      // globally-unique cuid so this isn't a cross-tenant leak risk on its own,
      // but pinning organizationId matches every other budgetLine read.
      ...(organizationId ? { organizationId } : {}),
      // Filter via the related plan's `year` field through a Prisma
      // relation predicate. Decouple plan: ACTUAL plans only (no-op until a
      // budget plan exists; existing plans default kind="actual").
      plan: { year, kind: "actual" },
      // deletedAt:null REQUIRED (2026-05-31): BudgetLine uses soft-delete-
      // then-insert on re-import. Without this the snapshot sums archived
      // rows alongside live ones — measured ×6.27 budgetLine inflation on
      // live data — corrupting the intel crossing-scan that consumes it.
      deletedAt: null,
    },
    select: {
      lineType: true,
      plannedAmount: true,
      originalAmount: true,
      currencyCode: true,
      exchangeRate: true,
    },
  })

  // Mirror aggregatePnlLines: a foreign line must have a finite positive
  // source rate. Base / blank-currency lines pass through with no rate. The
  // accepted `plannedAmount` remains its already-normalized base amount.
  const BASE_CCY = "AZN"
  const byType = new Map<string, number>()
  for (const l of lines) {
    const isForeign = isForeignCurrencyLine(l, BASE_CCY)
    if (isForeign && !isValidExchangeRate(l.exchangeRate)) continue
    const amountBase = l.plannedAmount
    byType.set(l.lineType, (byType.get(l.lineType) ?? 0) + amountBase)
  }
  const revenueAZN = byType.get("revenue") ?? null
  const cogsAZN = byType.get("cogs") ?? null
  const opexAZN = byType.get("expense") ?? null
  const ebitdaAZN =
    revenueAZN != null && cogsAZN != null && opexAZN != null
      ? revenueAZN - cogsAZN - opexAZN
      : null

  return {
    revenueAZN,
    cogsAZN,
    opexAZN,
    ebitdaAZN,
    period: String(year),
  }
}
