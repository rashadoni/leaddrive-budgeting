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
): Promise<CompanyFinancialsSnapshot> {
  const rows = await prisma.budgetLine.groupBy({
    by: ["lineType"],
    where: {
      companyId,
      // Filter via the related plan's `year` field through a Prisma
      // relation predicate.
      plan: { year },
      // deletedAt:null REQUIRED (2026-05-31): BudgetLine uses soft-delete-
      // then-insert on re-import. Without this the snapshot sums archived
      // rows alongside live ones — measured ×6.27 budgetLine inflation on
      // live data — corrupting the intel crossing-scan that consumes it.
      deletedAt: null,
    },
    _sum: { plannedAmount: true },
  })

  const byType = new Map<string, number>()
  for (const row of rows) {
    byType.set(row.lineType, row._sum.plannedAmount ?? 0)
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
