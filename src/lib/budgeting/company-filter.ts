/**
 * Helper: resolve a per-company filter for budgeting routes.
 *
 * Used by `/api/budgeting/analytics` + `/api/budgeting/pnl` to support
 * the per-daughter-company drilldown in the /budgeting hub. The hub
 * passes `?companyId=X`; backend uses this helper to return the list
 * of operational `companyId`s the BudgetLine query should match.
 *
 * Semantics:
 *   - companyId = null/undefined  → no filter (org-wide consolidated)
 *   - companyId = level=2 op-co   → [companyId] (just that one)
 *   - companyId = level=1 sub-grp → [...all child level=2 ids] (rollup)
 *   - companyId = level=1 with NO children → [] (returns empty filter,
 *       caller should treat as no-data for this entity)
 *
 * Cross-tenant guard: if the requested companyId doesn't belong to
 * orgId, returns null (caller should 404). Prevents cross-tenant
 * leakage via guessed/copied companyIds.
 */

import { PrismaClient } from "@prisma/client";

export type CompanyFilterResult =
  | { kind: "all" }
  | { kind: "single"; companyIds: string[]; resolvedFromLevel: 1 | 2 }
  | { kind: "not_found" };

export async function resolveCompanyFilter(
  prisma: PrismaClient,
  orgId: string,
  companyId: string | null | undefined,
): Promise<CompanyFilterResult> {
  if (!companyId) return { kind: "all" };

  // Tenant-scoped lookup; cross-tenant id → not_found (existence-leak guard)
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: orgId },
    select: { id: true, level: true },
  });
  if (!company) return { kind: "not_found" };

  if (company.level === 2) {
    return { kind: "single", companyIds: [company.id], resolvedFromLevel: 2 };
  }

  // level=1 sub-group → expand to children
  const children = await prisma.company.findMany({
    where: { parentCompanyId: company.id, organizationId: orgId },
    select: { id: true },
  });
  return {
    kind: "single",
    companyIds: children.map((c) => c.id),
    resolvedFromLevel: 1,
  };
}
