/**
 * Production-adapter shared context — extracted from
 * production-adapter-registry.ts (Phase 8 D1 2026-05-29) so the per-handler
 * factory files and the registry assembler share one source for the
 * per-orchestrator-call `OrgContext` (plan + companies + CoA + departments),
 * its lazy resolver, and the month-period helper. Imported by
 * production-adapter-handlers-financial.ts, -soft.ts, and the registry.
 */
import type { PrismaClient } from "@prisma/client"
import { getLogger } from "@/lib/log"

export const logger = getLogger("lib:prod-adapter")

export const CF_SOURCE_TAG = "azseker-workbook-cf"

/** Per-orchestrator-call context — resolved lazily on first use. */
export interface OrgContext {
  organizationId: string
  year: number
  /** Map: AZSEKER-* code → companyId. */
  codeToId: Map<string, string>
  /** Resolved BudgetPlan id for this org+year. */
  planId: string
  /** Cached AZSEKER-* company id list for sales-target resolution. */
  azsekerCompanies: Array<{ id: string; code: string }>
  // Phase 7.M Tier 7 (Phase 4) — revenue-generating BudgetDepartments for
  // SALES_FORECAST handler. Lower-cased label → id map matches the
  // /api/budgeting/sales-forecast/import resolution shape.
  deptLabelToId: Map<string, string>
  /** Map: ChartOfAccount.code → ChartOfAccount.id. Used by PLF/BS/CF
   *  handlers to populate accountId on every imported row so P&L
   *  classification is exact (no regex heuristics needed). */
  coaByCode: Map<string, string>
}

/**
 * Build (and cache via closure) the per-org context. Re-uses the
 * existing BudgetPlan or creates a new "Azərşəkər YYYY Budget" one.
 *
 * Note: this writes (BudgetPlan upsert) — but it's idempotent and
 * happens OUTSIDE the per-group tx. If the orchestrator later rolls
 * back the group, the plan row still exists (just empty), which is
 * harmless: the next run reuses it.
 */
export async function resolveOrgContext(
  prisma: PrismaClient,
  organizationId: string,
  year: number,
  // Decouple plan: resolve the plan by KIND, not by name. "actual" (default)
  // = the realized-results plan the terminal reads; "budget" = the forward
  // (operational) budget; "strategy" = the multi-year farming-strategy plan
  // (2026-06-20: the reporting-pack's "Budget PLF" carries the 10-yr strategy,
  // not the operational budget — kept as its own plan so standard
  // actual/budget variance never conflates the two). After the Y3 relabel,
  // finding by name would have collided with the empty budget plan and
  // mis-routed financial imports into it.
  kind: "actual" | "budget" | "strategy" = "actual",
): Promise<OrgContext> {
  const azsekerCompanies = await prisma.company.findMany({
    where: { organizationId, code: { startsWith: "AZSEKER" } },
    select: { id: true, code: true },
  })
  const codeToId = new Map<string, string>(
    azsekerCompanies.map((c: { id: string; code: string }) => [c.code, c.id]),
  )
  const planLabel = kind === "budget" ? "Budget" : kind === "strategy" ? "Strategy" : "Actuals"
  const planName = `Azərşəkər ${year} ${planLabel}`
  // Prefer the data-holding plan of this kind (oldest = the canonical one).
  let plan = await prisma.budgetPlan.findFirst({
    where: { organizationId, year, kind, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  if (!plan) {
    plan = await prisma.budgetPlan.create({
      data: {
        organizationId,
        year,
        name: planName,
        periodType: "annual",
        status: "draft",
        kind,
      },
      select: { id: true },
    })
  }
  // Phase 7.M Tier 7 (Phase 4) — load revenue-generating departments for
  // SALES_FORECAST handler. Same filter as /api/budgeting/sales-forecast/import.
  const departments = await prisma.budgetDepartment.findMany({
    where: { organizationId, hasRevenue: true, isActive: true },
    select: { id: true, label: true },
    orderBy: { sortOrder: "asc" },
  })
  const deptLabelToId = new Map<string, string>(
    departments.map((d: { id: string; label: string }) => [
      d.label.trim().toLowerCase(),
      d.id,
    ]),
  )

  const coaEntries = await prisma.chartOfAccount.findMany({
    where: { organizationId },
    select: { id: true, code: true },
  })
  const coaByCode = new Map<string, string>(
    coaEntries.map((a: { id: string; code: string }) => [a.code, a.id]),
  )

  return {
    organizationId,
    year,
    codeToId,
    planId: plan.id,
    azsekerCompanies,
    deptLabelToId,
    coaByCode,
  }
}

/** Convenience: month-period scope for batch functions. */
export function buildPeriodScope(year: number): string[] {
  return Array.from(
    { length: 12 },
    (_, m) => `${year}-${String(m + 1).padStart(2, "0")}`,
  )
}
