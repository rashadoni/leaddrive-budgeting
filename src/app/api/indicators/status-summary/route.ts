/**
 * Phase 7.G CXLVI — honest decision-surface status counts.
 *
 * GET /api/indicators/status-summary?period=YYYY[-MM]
 *
 * Returns counts over the same decision surface as the matrix leaf rows:
 * active, RBAC-scoped level-2 operational companies; active renderable
 * indicators; and only applicable company/indicator pairs. A stale cache row
 * for the wrong industry, an explicit CompanyIndicator disable, or an admin
 * cost-centre row must not inflate the HeatMap header badge.
 *
 * Response:
 *   { period, green, amber, red, unknown, total }
 */

import { NextRequest, NextResponse } from "next/server"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { currentBakuYear, parsePeriod, PeriodParseError } from "@/lib/risk/periods"
import {
  filterOperationalCompanies,
  preferOrgScopedDefinitions,
} from "@/lib/risk/targets"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import { loadPairApplicabilityResolver } from "@/lib/risk/pair-applicability"

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  const { orgId } = session
  if (!orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const periodParam = req.nextUrl.searchParams.get("period") ?? currentBakuYear()
  try {
    parsePeriod(periodParam)
  } catch (e) {
    if (e instanceof PeriodParseError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    throw e
  }

  const includePending = req.nextUrl.searchParams.get("includePending") === "true"
  const scope = await getCompanyScope(orgId, session.userId, session.role)

  const applicableStatuses = await withOrgScope(orgId, async (tx) => {
    const [companiesRaw, indicatorRows] = await Promise.all([
      tx.company.findMany({
        where: {
          organizationId: orgId,
          isActive: true,
          ...(includePending ? {} : { status: { not: "pending" } }),
          ...(scope.ids ? { id: { in: Array.from(scope.ids) } } : {}),
        },
        select: {
          id: true,
          code: true,
          industry: true,
          level: true,
          isActive: true,
          role: true,
        },
      }),
      // Fetch the complete active global+tenant catalogue first. Visibility
      // is resolved only after same-code tenant precedence below; filtering
      // internal rows in SQL would drop an internal tenant override and let
      // the shadowed global definition leak back into the status count.
      tx.indicatorDefinition.findMany({
        where: {
          isActive: true,
          OR: [{ organizationId: null }, { organizationId: orgId }],
        },
        select: {
          id: true,
          code: true,
          organizationId: true,
          industries: true,
          isActive: true,
          category: true,
          requiredInputs: true,
        },
      }),
    ])

    const operational = filterOperationalCompanies(companiesRaw)
    // A tenant definition replaces the global definition with the same code;
    // counting both ids would double-count one logical KPI and could report
    // contradictory statuses for the same company/code pair.
    // Internal indicators never produce rendered operational leaf cells in
    // the matrix. Prefer the tenant definition first, then apply that leaf
    // visibility rule so a same-code global cannot bypass a tenant override.
    const indicators = preferOrgScopedDefinitions(indicatorRows).filter(
      (indicator) => indicator.category !== "internal",
    )
    const companyIds = operational.map((company) => company.id)
    const indicatorIds = indicators.map((indicator) => indicator.id)
    if (companyIds.length === 0 || indicatorIds.length === 0) return []

    const [pairApplicability, values] = await Promise.all([
      loadPairApplicabilityResolver(tx, {
        organizationId: orgId,
        companies: operational,
        definitions: indicators,
      }),
      tx.indicatorValue.findMany({
        where: {
          organizationId: orgId,
          period: periodParam,
          companyId: { in: companyIds },
          indicatorId: { in: indicatorIds },
        },
        select: { companyId: true, indicatorId: true, status: true },
      }),
    ])

    const companyById = new Map(
      operational.map((company) => [company.id, company]),
    )
    const indicatorById = new Map(
      indicators.map((indicator) => [indicator.id, indicator]),
    )
    return values
      .filter((value) => {
        const company = companyById.get(value.companyId)
        const indicator = indicatorById.get(value.indicatorId)
        return Boolean(
          company &&
            indicator &&
            pairApplicability.isApplicable(company, indicator),
        )
      })
      .map((value) => value.status)
  })

  const summary = { period: periodParam, green: 0, amber: 0, red: 0, unknown: 0, total: 0 }
  for (const status of applicableStatuses) {
    const s = status as keyof typeof summary
    if (s === "green" || s === "amber" || s === "red" || s === "unknown") {
      summary[s] += 1
      summary.total += 1
    }
  }

  return NextResponse.json(summary)
}
