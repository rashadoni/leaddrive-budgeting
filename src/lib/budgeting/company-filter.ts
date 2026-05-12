/**
 * Helper: resolve a per-company filter for budgeting routes.
 *
 * Used by `/api/budgeting/analytics` + `/api/budgeting/pnl` to support
 * the per-daughter-company drilldown in the /budgeting hub. The hub
 * passes `?companyId=X`; backend uses this helper to return the list
 * of operational `companyId`s the BudgetLine query should match.
 *
 * Semantics:
 *   - companyId = null/undefined → no filter (org-wide consolidated)
 *   - companyId = leaf op-co     → [companyId] (just that one)
 *   - companyId = sub-group OR
 *     holding root               → all LEAF descendants (BFS through
 *                                    the tree until we hit nodes with
 *                                    no children). Handles 2-level
 *                                    AND 3-level holdings (FO Holding
 *                                    has AZMADE → AAC → AAC-MAIN: a
 *                                    1-hop expansion misses leaves).
 *   - sub-group with NO descendants → [] (caller treats as no-data)
 *
 * Cross-tenant guard: if the requested companyId doesn't belong to
 * orgId, returns `not_found`. Prevents cross-tenant leakage via
 * guessed/copied companyIds.
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

  // Sub-group / holding-root → BFS for all leaf descendants. Loads the
  // entire org tree (~60 rows max, single query) and traverses in JS.
  // Cheaper than recursive DB calls for shallow trees.
  const all = await prisma.company.findMany({
    where: { organizationId: orgId },
    select: { id: true, parentCompanyId: true },
  });
  type Node = (typeof all)[number];
  const childrenOf = new Map<string, string[]>();
  for (const c of all as Node[]) {
    if (c.parentCompanyId) {
      const arr = childrenOf.get(c.parentCompanyId) ?? [];
      arr.push(c.id);
      childrenOf.set(c.parentCompanyId, arr);
    }
  }
  // BFS from selected node, collect IDs that have no children (leaves).
  const leaves: string[] = [];
  const queue = [company.id];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      // Leaf — but skip the root itself (caller's selected node) when
      // it has no children at all (returns empty array as before).
      if (id !== company.id) leaves.push(id);
    } else {
      queue.push(...kids);
    }
  }
  return {
    kind: "single",
    companyIds: leaves,
    resolvedFromLevel: 1,
  };
}
