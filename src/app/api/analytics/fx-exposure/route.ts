/**
 * Phase 7.J — Currency exposure breakdown.
 *
 * GET /api/analytics/fx-exposure?year=2026&companyId=<optional>
 *
 * Aggregates source-currency exposure × lineType × currencyCode per
 * year (and optionally per company), producing a breakdown of how
 * much revenue / COGS / expense is denominated in AZN vs USD vs EUR
 * vs other. Used by the FX dashboard widget + drives the AI Variance
 * Explainer's FX-sensitivity context.
 *
 * Response shape:
 *   {
 *     year: 2026,
 *     companyId: "<id>" | null,
 *     totals: { AZN: { revenue: N, cogs: N, expense: N }, USD: {...} },
 *     netExposureByCurrency: { AZN: <rev-cogs-exp>, USD: ... },
 *     baseCurrency: "AZN"
 *   }
 *
 * Hedge-decision use: a positive USD net exposure means we are USD-
 * long (revenue heavy), negative means USD-short (cost-heavy). CFO
 * uses this to size forward-rate hedges.
 */
import { NextRequest, NextResponse } from "next/server"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireRole, isAuthError } from "@/lib/api-auth"

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  const url = new URL(request.url)
  const yearRaw = url.searchParams.get("year")
  const companyIdRaw = url.searchParams.get("companyId")
  const year =
    yearRaw && Number.isInteger(Number(yearRaw)) ? Number(yearRaw) : new Date().getUTCFullYear()
  const companyId = companyIdRaw && companyIdRaw.trim() !== "" ? companyIdRaw : null

  const lines = await withOrgScope(orgId, (tx) =>
    tx.budgetLine.findMany({
      where: {
        organizationId: orgId,
        plan: { is: { year } },
        deletedAt: null,
        ...(companyId ? { companyId } : {}),
      },
      select: {
        lineType: true,
        plannedAmount: true,
        originalAmount: true,
        currencyCode: true,
        exchangeRate: true,
      },
    }),
  )

  // Aggregate. Base/null-currency lines use their canonical base amount.
  // Explicit foreign exposure must come from finite source amount + finite,
  // positive conversion evidence. Never relabel plannedAmount as USD/EUR:
  // it is already base/reporting currency by the BudgetLine contract.
  type LineType = "revenue" | "cogs" | "expense"
  const totals: Record<string, Record<LineType, number>> = {}
  const excludedForeignByCurrency: Record<string, number> = {}
  for (const l of lines) {
    const cur = l.currencyCode || "AZN"
    const lt = (l.lineType as LineType) || "expense"
    const isForeign = l.currencyCode != null && l.currencyCode !== "AZN"
    const hasSourceEvidence =
      typeof l.originalAmount === "number" &&
      Number.isFinite(l.originalAmount) &&
      typeof l.exchangeRate === "number" &&
      Number.isFinite(l.exchangeRate) &&
      l.exchangeRate > 0
    if (isForeign && !hasSourceEvidence) {
      excludedForeignByCurrency[cur] = (excludedForeignByCurrency[cur] ?? 0) + 1
      continue
    }
    if (!totals[cur]) totals[cur] = { revenue: 0, cogs: 0, expense: 0 }
    totals[cur][lt] += isForeign ? l.originalAmount! : l.plannedAmount
  }

  const netExposureByCurrency: Record<string, number> = {}
  for (const [cur, v] of Object.entries(totals)) {
    // Net = revenue - cogs - expense (USD-long is positive, USD-short
    // is negative). Same convention as the gross-profit calc used by
    // the Risk Terminal so badges + dashboard agree.
    netExposureByCurrency[cur] = v.revenue - v.cogs - v.expense
  }

  return NextResponse.json({
    year,
    companyId,
    baseCurrency: "AZN",
    totals,
    netExposureByCurrency,
    lineCount: lines.length,
    // Source exposure is intentionally fail-closed. Consumers can distinguish
    // a genuine zero exposure from foreign rows whose provenance is incomplete.
    excludedForeignLineCount: Object.values(excludedForeignByCurrency).reduce(
      (count, excluded) => count + excluded,
      0,
    ),
    excludedForeignByCurrency,
  })
}
