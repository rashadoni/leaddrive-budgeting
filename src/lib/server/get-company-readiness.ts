/**
 * Phase 7.M Step 5 (2026-05-19) — DB reader for per-company readiness.
 *
 * Joins six tables in one batch to compute readiness for every
 * operating company in an organisation. Returns a Map<companyId, score>
 * so the matrix endpoint can stamp `readiness` on each MatrixCompanyRow
 * without an N+1 fan-out.
 *
 * Performance shape: 6 grouped queries × org-scoped predicates. At
 * the holding's current scale (10-60 companies × a few hundred rows
 * each) this is ~50ms. If the holding grows past 500 companies, the
 * groupBy queries should be pushed into a single raw SQL or a
 * read-replica view.
 */
import type { PrismaClient } from "@prisma/client"
import {
  computeCompanyReadiness,
  type ReadinessInputs,
  type ReadinessResult,
} from "./company-readiness"

export type CompanyReadinessMap = ReadonlyMap<string, ReadinessResult>

/**
 * Compute readiness for every level=2 (operational) company in the
 * organisation. Level-1 rollup parents are excluded — their readiness
 * is the worst-of-children, which is the caller's concern (the
 * CompanyTree can derive it on the fly from the per-leaf map).
 */
export async function getCompanyReadiness(
  prisma: PrismaClient,
  organizationId: string,
): Promise<CompanyReadinessMap> {
  // 1. Companies in scope. Pre-filter pending/archived to mirror the
  //    matrix endpoint's company list.
  const companies = await prisma.company.findMany({
    where: {
      organizationId,
      isActive: true,
      status: { notIn: ["pending", "archived"] },
    },
    select: { id: true, settings: true },
  })
  if (companies.length === 0) return new Map()

  const ids = companies.map((c) => c.id)

  // 2. Budget line aggregates per company. We pull line_count and a
  //    distinct lineType count.
  const blGroups = await prisma.budgetLine.groupBy({
    by: ["companyId", "lineType"],
    where: {
      organizationId,
      companyId: { in: ids },
      deletedAt: null,
    },
    _count: { _all: true },
  })
  // Index by companyId.
  const blByCompany = new Map<
    string,
    { count: number; lineTypes: Set<string> }
  >()
  for (const g of blGroups) {
    if (!g.companyId) continue
    const cur = blByCompany.get(g.companyId) ?? {
      count: 0,
      lineTypes: new Set(),
    }
    cur.count += g._count._all
    cur.lineTypes.add(g.lineType)
    blByCompany.set(g.companyId, cur)
  }

  // 3. Foreign-currency budget lines per company. Counts rows where
  //    currencyCode is set AND differs from the company base. Because
  //    the schema doesn't carry the base ccy on the budget_line, we
  //    just look for "non-null currencyCode" — adequate proxy.
  const fxGroups = await prisma.budgetLine.groupBy({
    by: ["companyId"],
    where: {
      organizationId,
      companyId: { in: ids },
      deletedAt: null,
      currencyCode: { not: null },
      exchangeRate: { not: null },
    },
    _count: { _all: true },
  })
  const fxByCompany = new Set<string>(
    fxGroups
      .filter((g) => g.companyId !== null && g._count._all > 0)
      .map((g) => g.companyId as string),
  )

  // 4. Balance sheet presence per company. BS lines are plan-scoped,
  //    so we have to bridge via budget_plans → budget_lines to know
  //    which plan contains each company's data. We look up which
  //    plans have BS lines, then take the union of companies on those
  //    plans.
  const bsLineGroups = await prisma.balanceSheetLine.groupBy({
    by: ["planId"],
    where: { organizationId, deletedAt: null },
    _count: { _all: true },
  })
  const plansWithBs = bsLineGroups
    .filter((g) => g._count._all > 0)
    .map((g) => g.planId)
  const companiesWithBs = new Set<string>()
  if (plansWithBs.length > 0) {
    const planCompanyRows = await prisma.budgetLine.findMany({
      where: {
        organizationId,
        planId: { in: plansWithBs },
        companyId: { in: ids },
        deletedAt: null,
      },
      select: { companyId: true },
      distinct: ["companyId"],
    })
    for (const r of planCompanyRows) {
      if (r.companyId) companiesWithBs.add(r.companyId)
    }
  }

  // 5. Counterparty counts per company × role.
  const cpGroups = await prisma.counterparty.groupBy({
    by: ["companyId", "role"],
    where: {
      organizationId,
      companyId: { in: ids },
      deletedAt: null,
    },
    _count: { _all: true },
  })
  const cpByCompany = new Map<
    string,
    { customers: number; suppliers: number }
  >()
  for (const g of cpGroups) {
    const cur = cpByCompany.get(g.companyId) ?? { customers: 0, suppliers: 0 }
    if (g.role === "customer") cur.customers = g._count._all
    else if (g.role === "supplier") cur.suppliers = g._count._all
    cpByCompany.set(g.companyId, cur)
  }

  // 6. Operational fact distinct metric count per company.
  const ofRows = await prisma.operationalFact.groupBy({
    by: ["companyId", "metric"],
    where: { organizationId, companyId: { in: ids } },
  })
  const ofByCompany = new Map<string, Set<string>>()
  for (const r of ofRows) {
    const set = ofByCompany.get(r.companyId) ?? new Set<string>()
    set.add(r.metric)
    ofByCompany.set(r.companyId, set)
  }

  // 7. Computed indicator count (status != unknown) per company.
  const ivGroups = await prisma.indicatorValue.groupBy({
    by: ["companyId"],
    where: {
      organizationId,
      companyId: { in: ids },
      status: { not: "unknown" },
    },
    _count: { _all: true },
  })
  const computedIvByCompany = new Map<string, number>(
    ivGroups.map((g) => [g.companyId, g._count._all]),
  )

  // 8. Assemble per company.
  const out = new Map<string, ReadinessResult>()
  for (const co of companies) {
    const bl = blByCompany.get(co.id) ?? { count: 0, lineTypes: new Set() }
    const cp = cpByCompany.get(co.id) ?? { customers: 0, suppliers: 0 }
    const ofMetrics = ofByCompany.get(co.id) ?? new Set()
    const settings = (co.settings ?? {}) as Record<string, unknown>
    const narrative =
      typeof settings.strategicNarrative === "string"
        ? settings.strategicNarrative
        : ""

    const inputs: ReadinessInputs = {
      budgetLineCount: bl.count,
      budgetLineTypeCount: bl.lineTypes.size,
      hasBalanceSheet: companiesWithBs.has(co.id),
      customerCount: cp.customers,
      supplierCount: cp.suppliers,
      operationalFactMetricCount: ofMetrics.size,
      strategicNarrativeLength: narrative.length,
      computedIndicatorCount: computedIvByCompany.get(co.id) ?? 0,
      hasForeignCurrencyTags: fxByCompany.has(co.id),
    }
    out.set(co.id, computeCompanyReadiness(inputs))
  }

  return out
}
