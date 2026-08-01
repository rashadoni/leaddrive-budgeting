/**
 * Phase 1.4 (closed 2026-05-26) — physical purge of soft-deleted rows.
 *
 * Tables with deletedAt+deletedBy columns (see schema):
 *   - BudgetPlan        (cascades to lines/actuals/sections/etc.)
 *   - CashFlowEntry     (leaf)
 *   - BalanceSheetLine  (leaf)
 *   - Counterparty      (leaf)
 *
 * Rows whose deletedAt is older than `cutoffMs` (default 30 days) are
 * physically removed. The "Restore" UI in `/budgeting/admin/data-archive`
 * is the user's only restore window — once cleanup runs, the rows are
 * gone. Per Phase 1.4 design, 30-day TTL matches the in-UI countdown.
 *
 * Idempotent: a second pass in the same minute is safe (cutoff filter
 * leaves nothing to delete). Caller is responsible for emitting one
 * audit event per RUN with the returned counts (per-row audit would
 * explode the table on heavy purges; the soft-delete event already
 * captured the per-row intent).
 *
 * All four deletes run inside a single Prisma transaction so a partial
 * crash leaves the DB consistent — either all four tables purge or
 * none do.
 */

import type { PrismaClient } from "@prisma/client"

/** Default retention window — matches the 30-day countdown shown to
 *  users in the Recently-Deleted UI. */
export const SOFT_DELETE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The same window in days, for the copy that quotes it.
 *
 * 2026-07-31 — the Delete data screen used to quote a dead 90-day constant,
 * so the previous pass removed the number from that screen entirely. Silence
 * was the other kind of wrong: it made "can be brought back from this page"
 * read as an offer with no expiry, on the one screen in the product that did
 * not state the window (`budgeting.restoreSectionTitle` states it, correctly).
 * The number is back, DERIVED, so it cannot drift from the job again.
 *
 * This module imports only `type PrismaClient`, so client components can
 * import this constant without pulling Prisma into the browser bundle.
 */
export const SOFT_DELETE_RETENTION_DAYS = Math.round(
  SOFT_DELETE_TTL_MS / (24 * 60 * 60 * 1000),
)

export interface CleanupCounts {
  budgetPlans: number
  cashFlowEntries: number
  balanceSheetLines: number
  counterparties: number
  /** Sum of parent-row deletes only; cascade children are not counted
   *  (Prisma's deleteMany returns the row count for the target table
   *  only, not the cascade fan-out). */
  total: number
}

export interface CleanupOptions {
  /** Override the 30-day retention. Tests use shorter windows. */
  cutoffMs?: number
  /** Count-only mode for dashboards / scheduler dry runs. */
  dryRun?: boolean
  /** Inject "now" so tests don't depend on wall-clock time. */
  now?: Date
}

const EMPTY_COUNTS: CleanupCounts = {
  budgetPlans: 0,
  cashFlowEntries: 0,
  balanceSheetLines: 0,
  counterparties: 0,
  total: 0,
}

export async function runSoftDeleteCleanup(
  prisma: PrismaClient,
  opts: CleanupOptions = {},
): Promise<CleanupCounts> {
  const cutoffMs = opts.cutoffMs ?? SOFT_DELETE_TTL_MS
  const now = opts.now ?? new Date()
  const cutoff = new Date(now.getTime() - cutoffMs)
  const where = { deletedAt: { lt: cutoff } } as const

  if (opts.dryRun) {
    const [budgetPlans, cashFlowEntries, balanceSheetLines, counterparties] =
      await Promise.all([
        prisma.budgetPlan.count({ where }),
        prisma.cashFlowEntry.count({ where }),
        prisma.balanceSheetLine.count({ where }),
        prisma.counterparty.count({ where }),
      ])
    return tally(
      budgetPlans,
      cashFlowEntries,
      balanceSheetLines,
      counterparties,
    )
  }

  const [budgetPlans, cashFlowEntries, balanceSheetLines, counterparties] =
    await prisma.$transaction([
      prisma.budgetPlan.deleteMany({ where }),
      prisma.cashFlowEntry.deleteMany({ where }),
      prisma.balanceSheetLine.deleteMany({ where }),
      prisma.counterparty.deleteMany({ where }),
    ])

  return tally(
    budgetPlans.count,
    cashFlowEntries.count,
    balanceSheetLines.count,
    counterparties.count,
  )
}

function tally(
  budgetPlans: number,
  cashFlowEntries: number,
  balanceSheetLines: number,
  counterparties: number,
): CleanupCounts {
  return {
    budgetPlans,
    cashFlowEntries,
    balanceSheetLines,
    counterparties,
    total:
      budgetPlans + cashFlowEntries + balanceSheetLines + counterparties,
  }
}

export const __testing = { EMPTY_COUNTS }
