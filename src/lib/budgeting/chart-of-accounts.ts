/**
 * Phase 2.1 step 2 — ChartOfAccount FK resolver for BudgetLine writers.
 *
 * Schema shipped earlier in Phase 2.1: `BudgetLine.accountId String?` +
 * `account ChartOfAccount?` relation. Writers that know the SAP-style
 * code (e.g. "601-01-02") can populate the FK via this helper, which
 * removes the `looksLikeSapCode()` heuristic from analytics/pnl readers
 * over time as more writers adopt the FK path.
 *
 * Behavior:
 *  - If `category` matches the SAP-code shape (`/^\d{3}(-\d+)*$/`),
 *    look up `ChartOfAccount` by `(orgId, code)` and return the id.
 *  - Otherwise (free-text category like "Sales — Hospitality") return
 *    `null` so the writer leaves `accountId` unset and the legacy
 *    `category` string drives the display.
 *  - On no-match-by-code → return `null` (the FK is optional; the
 *    string fallback keeps working). Caller may also choose to
 *    auto-create the row, but that's the AI-mapper /apply path's job
 *    (it has the `accountType` + `name` to create with). Single-line
 *    POSTs don't have those, so we only LOOK UP, not CREATE here.
 *
 * Pure function — no DB schema changes, no migration. Test gate
 * mocks `prisma.chartOfAccount.findUnique`.
 */

import type { PrismaClient } from '@prisma/client';

/** Regex anchored to SAP-style codes ("601" / "601-01" / "601-01-02").
 *  Identical to the heuristic at `analytics/route.ts:394` so the
 *  detection rule stays consistent across reader + writer paths. */
const SAP_CODE_PATTERN = /^\d{3}(-\d+)*$/;

export function looksLikeAccountCode(s: string): boolean {
  return SAP_CODE_PATTERN.test(s);
}

/** Minimal Prisma client surface used by the resolver. Lets handler
 *  tests pass a vi.fn() mock without committing to the full client. */
export interface ChartOfAccountLookupClient {
  chartOfAccount: {
    findUnique: (args: {
      where: {
        organizationId_code: {
          organizationId: string;
          code: string;
        };
      };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
}

/**
 * Look up `ChartOfAccount.id` by `(orgId, category)` IF `category`
 * looks like a SAP code. Returns `null` for free-text categories or
 * when no row matches.
 *
 * Caller pattern:
 * ```ts
 * const accountId = await resolveAccountId(prisma, orgId, category);
 * await prisma.budgetLine.create({
 *   data: { …, category, accountId, … },
 * });
 * ```
 */
export async function resolveAccountId(
  prisma: ChartOfAccountLookupClient | PrismaClient,
  orgId: string,
  category: string,
): Promise<string | null> {
  if (!category || !looksLikeAccountCode(category)) return null;
  const row = await prisma.chartOfAccount.findUnique({
    where: { organizationId_code: { organizationId: orgId, code: category } },
    select: { id: true },
  });
  return row?.id ?? null;
}
