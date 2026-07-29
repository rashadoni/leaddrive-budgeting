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
  /** Phase 11.11 — every non-archived company in the org (was: only
   *  `AZSEKER*`, which made the writer blind to every other entity). */
  /** Phase 11.33 — `name` added: the cross-entity soft registers (audit
   *  findings, court cases) name the company in a CELL, so resolving them
   *  needs the registered name, not just the code. */
  orgCompanies: Array<{ id: string; code: string; name: string | null }>
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
  // budget. After the Y3 relabel, finding by name would have collided with the
  // empty budget plan and mis-routed financial imports into it.
  kind: "actual" | "budget" = "actual",
): Promise<OrgContext> {
  // Phase 11.11 (2026-07-29) — load EVERY company in the organization, not
  // just `AZSEKER*`.
  //
  // The classifier is handed every company in the org, but this writer-side
  // map was filtered to one hardcoded code prefix. Anything else resolved to
  // `undefined`: for PLF that is a silent sheet skip (0 rows, green report);
  // for BS it was worse — no guard, so rows were written with
  // `companyId: null`, which degraded `bs-import-batch`'s company scope to
  // `{}` and archived EVERY company's balances on that plan for that year.
  // The collateral guard could not catch it either, because
  // `footprintLiveCount` was computed from the same degenerate scope.
  //
  // This is a hard prerequisite for the ~60-company wire-up (ROADMAP 7.B):
  // ATL-*, SPARK-MAIN, ZTP-MAIN and AAC-MAIN already live in this org and
  // are already offered to the classifier — the writer just could not see
  // them. Archived companies stay excluded: an import must not resurrect one.
  const orgCompanies = await prisma.company.findMany({
    where: { organizationId, status: { not: "archived" } },
    select: { id: true, code: true, name: true },
  })
  const codeToId = new Map<string, string>(
    orgCompanies.map((c: { id: string; code: string }) => [c.code, c.id]),
  )
  const planName = `Azərşəkər ${year} ${kind === "budget" ? "Budget" : "Actuals"}`
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
    orgCompanies,
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
