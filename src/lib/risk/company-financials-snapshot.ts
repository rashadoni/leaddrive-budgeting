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
  organizationId?: string,
): Promise<CompanyFinancialsSnapshot> {
  // Fetch per-line (not groupBy._sum) so foreign-currency lines can be
  // FX-normalized to base before summing — a raw groupBy would add a USD
  // plannedAmount straight into the "AZN" totals (the return type promises AZN).
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
    select: { lineType: true, plannedAmount: true, currencyCode: true, exchangeRate: true },
  })

  // FX-normalize to base (AZN). Mirror aggregatePnlLines: a foreign line
  // (currencyCode set and != base) with NO exchangeRate can't be converted, so
  // SKIP it rather than summing a raw foreign amount as if it were AZN. Base /
  // blank-currency lines pass through unconverted. (No-op for all-AZN data.)
  const BASE_CCY = "AZN"
  const byType = new Map<string, number>()
  for (const l of lines) {
    const isForeign = l.currencyCode != null && l.currencyCode !== BASE_CCY
    if (isForeign && l.exchangeRate == null) continue // unconvertible — exclude
    const amountBase = isForeign ? l.plannedAmount * (l.exchangeRate as number) : l.plannedAmount
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
