/**
 * Phase 7.F sub-group RBAC — resolve a user's company visibility scope.
 *
 * Returns:
 *   - `null`  — user has full access (admin role OR no allowedSubGroupIds set)
 *   - `Set<string>` of Company IDs the user can see
 *
 * The set includes:
 *   1. The sub-group IDs themselves (level-1 Company rows)
 *   2. All operational children whose `parentCompanyId` is in (1)
 *
 * Caller pattern:
 *   const scope = await getCompanyScope(orgId, userId, role)
 *   const where = scope ? { companyId: { in: [...scope] } } : {}
 *
 * Single Prisma round-trip; result lifetime is per-request (no cache —
 * a sub-group reassignment surfaces immediately on the next call).
 */

import { prisma } from "@/lib/prisma"

export interface CompanyScope {
  /** Null = unrestricted; Set = explicit allow-list. */
  ids: Set<string> | null
  /** True if RBAC was bypassed (admin role). */
  bypassed: boolean
}

export async function getCompanyScope(
  organizationId: string,
  userId: string,
  role: string,
): Promise<CompanyScope> {
  // Admin always sees everything. Skip DB read.
  if (role === "admin") {
    return { ids: null, bypassed: true }
  }
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { allowedSubGroupIds: true },
  })
  // Missing user (deleted mid-session?) → fail closed: empty set means
  // they see nothing. Better than null=full access for an unknown actor.
  if (!user) {
    return { ids: new Set(), bypassed: false }
  }
  const allowed = user.allowedSubGroupIds
  if (!allowed || allowed.length === 0) {
    // Empty array semantics = full access (default for legacy users).
    // To enable RBAC for a user, populate this array.
    return { ids: null, bypassed: false }
  }
  // Resolve sub-group IDs + their children in a single query.
  const companies = await prisma.company.findMany({
    where: {
      organizationId,
      OR: [
        { id: { in: allowed } },
        { parentCompanyId: { in: allowed } },
      ],
    },
    select: { id: true },
  })
  const ids = new Set<string>()
  type Row = (typeof companies)[number]
  for (const c of companies as Row[]) ids.add(c.id)
  return { ids, bypassed: false }
}
