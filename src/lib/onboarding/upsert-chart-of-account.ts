/**
 * Phase 2.1 session 1 (2026-05-26) — idempotent CoA upsert helper for
 * import adapters.
 *
 * Background: AI Auto Import adapters previously did
 * `coaByCode.get(code) ?? null` for accountId resolution. The cache
 * was built from existing ChartOfAccount rows, so any code from an
 * xlsx that wasn't pre-seeded produced `accountId = null`. Empirical
 * cost (audit 2026-05-26): 77 % of BudgetLines, 100 % of
 * COGSBudgetLine / BalanceSheetLine / CashFlowEntry had NULL FK,
 * which forced pnl/analytics to fall back to looksLikeSapCode regex
 * heuristics on free-form category strings.
 *
 * The fix: every adapter that writes a ledger row first calls
 * `resolveOrCreateAccountId` here. If the (orgId, code) pair already
 * exists in ChartOfAccount, return its id; otherwise upsert with a
 * sensible default (role='unknown', the new code as the name) so the
 * row can still be classified later via the admin override UI at
 * `/budgeting/admin/chart-of-accounts`.
 *
 * Caller responsibility: pass a SHARED `CoAAccountCache` across all
 * rows of one import batch so the same code in row 1 and row 5000
 * resolves with one round-trip to Postgres (cache hit on row 5000).
 * The cache is per-batch — do NOT reuse across batches because
 * concurrent admin edits to CoA wouldn't be visible to a stale cache.
 *
 * Concurrency safety: uses `prisma.chartOfAccount.upsert` which is
 * atomic at the (orgId, code) unique-index level. Two concurrent
 * imports of the same code race-safe converge to a single row.
 */

import type { Prisma } from "@prisma/client"

/** Mutation-cache that maps `${organizationId}::${code}` → ChartOfAccount.id.
 *  Caller creates one per import batch and threads it through every
 *  row resolution. */
export type CoAAccountCache = Map<string, string>

export function createCoACache(): CoAAccountCache {
  return new Map()
}

export interface ResolveCoAArgs {
  organizationId: string
  code: string
  /** Best-effort default display name when creating a new CoA row.
   *  Existing rows are NOT updated. */
  defaultName?: string
  /** Default accountType for new rows. Existing rows are NOT updated.
   *  Use "expense" when unknown — the admin override UI lets a finance
   *  reviewer reclassify. */
  defaultAccountType?: string
}

const VALID_ACCOUNT_TYPES = new Set([
  "revenue",
  "expense",
  "cogs",
  "asset",
  "liability",
  "equity",
])

/**
 * Returns the ChartOfAccount.id for `(organizationId, code)`, creating
 * a new row with role='unknown' if absent. Side-effect: caches the
 * resolution so subsequent calls within the same batch are O(1).
 *
 * Accepts `Prisma.TransactionClient` so the upsert is part of the
 * outer batch transaction — atomic with the line insert it precedes.
 */
export async function resolveOrCreateAccountId(
  tx: Prisma.TransactionClient,
  cache: CoAAccountCache,
  args: ResolveCoAArgs,
): Promise<string> {
  const cacheKey = `${args.organizationId}::${args.code}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const defaultAccountType = args.defaultAccountType ?? "expense"
  const accountType = VALID_ACCOUNT_TYPES.has(defaultAccountType)
    ? defaultAccountType
    : "expense"

  const row = await tx.chartOfAccount.upsert({
    where: {
      organizationId_code: {
        organizationId: args.organizationId,
        code: args.code,
      },
    },
    update: {
      // Idempotent — we deliberately don't overwrite name/accountType
      // on existing rows. An admin-set classification beats whatever a
      // raw xlsx header happened to say.
    },
    create: {
      organizationId: args.organizationId,
      code: args.code,
      name: args.defaultName ?? args.code,
      accountType,
      role: "unknown",
    },
    select: { id: true },
  })
  cache.set(cacheKey, row.id)
  return row.id
}

/** Convenience: bulk pre-warm the cache from an existing
 *  `findMany({ where: { organizationId }, select: { code, id } })` call.
 *  Adapters that already build such a list (e.g. production-adapter-
 *  registry's `coaByCode`) can seed the cache without an extra query. */
export function preWarmCoACache(
  cache: CoAAccountCache,
  organizationId: string,
  entries: ReadonlyArray<{ code: string; id: string }>,
): void {
  for (const e of entries) {
    cache.set(`${organizationId}::${e.code}`, e.id)
  }
}
