/**
 * Phase 7.M Step 4 (2026-05-18) — soft-delete helpers.
 *
 * Why this module exists
 * ──────────────────────
 * The 2026-05-18 schema migration added `deletedAt: DateTime?` and
 * `deletedBy: String?` to four tables (`budget_lines`,
 * `balance_sheet_lines`, `cash_flow_entries`, `counterparties`). Rows
 * with `deletedAt != null` are archived — invisible to the HeatMap,
 * recompute pipeline and exports, but recoverable via the admin Delete data
 * UI within the retention window the purge job enforces
 * (`SOFT_DELETE_RETENTION_DAYS`, 30 days). This header said 90 for two
 * months; that number never existed anywhere but in prose.
 *
 * Compliance / finance trust posture: the archive is a non-destructive
 * operation. IFRS / tax / audit retention rules require 7-year history,
 * so we never `DELETE` financial rows in v1 — only flip the timestamp.
 * A cleanup job (later) will purge rows past retention.
 *
 * What's here
 * ───────────
 *  • `EXCLUDE_DELETED` — the canonical Prisma `where` snippet to compose
 *    into read queries: `{ deletedAt: null }`.
 *  • `archiveStamp(userId)` — the canonical Prisma `data` snippet to
 *    compose into archive writes: `{ deletedAt: new Date(), deletedBy
 *    : userId }`.
 *  • `restoreStamp()` — the inverse, for the admin "Restore" action.
 *
 * Why not Prisma client extensions?
 * ─────────────────────────────────
 * Prisma extensions can globally rewrite every `findMany` to inject
 * `deletedAt: null`. Tempting, but it has two failure modes for a
 * finance application:
 *  1. The admin Archive UI MUST be able to read archived rows (to show
 *     "what's in the trash"). A globally-rewritten client makes that
 *     impossible without an escape hatch.
 *  2. Schema drift — if a new table is added without the field, the
 *     extension silently crashes at runtime.
 *
 * Explicit, opt-in helpers keep both directions of the read path
 * deliberate and grep-able.
 */

/**
 * The canonical "exclude soft-deleted" `where` snippet.
 *
 * Compose with the spread operator:
 * ```ts
 *   prisma.budgetLine.findMany({
 *     where: {
 *       organizationId,
 *       companyId,
 *       ...EXCLUDE_DELETED,
 *     }
 *   })
 * ```
 *
 * Using a frozen constant rather than a function call means tsc can
 * verify it composes correctly with each table's `where` shape, and
 * the read overhead is zero.
 */
export const EXCLUDE_DELETED = Object.freeze({
  deletedAt: null as null,
})

/**
 * Build the `data` payload for the archive operation. Pass the user
 * id from the session so the audit trail can answer "who archived
 * this?".
 *
 * Use:
 * ```ts
 *   await prisma.budgetLine.updateMany({
 *     where: { ...EXCLUDE_DELETED, companyId, year: 2024 },
 *     data: archiveStamp(session.userId),
 *   })
 * ```
 *
 * @param userId — string id of the User who initiated the archive.
 *                 Use the literal `'system'` for cron / CLI initiators.
 */
export function archiveStamp(userId: string): {
  deletedAt: Date
  deletedBy: string
} {
  return { deletedAt: new Date(), deletedBy: userId }
}

/**
 * Inverse of `archiveStamp` — clears the soft-delete fields so a row
 * becomes live again. Used by the admin "Restore" action and by
 * tests.
 */
export function restoreStamp(): {
  deletedAt: null
  deletedBy: null
} {
  return { deletedAt: null, deletedBy: null }
}

/**
 * 2026-07-31 — `SOFT_DELETE_RETENTION_DAYS = 90` and `softDeletePurgeCutoff()`
 * used to live here. Nothing called them but their own test.
 *
 * The job that actually purges soft-deleted rows uses `SOFT_DELETE_TTL_MS` in
 * `src/lib/cleanup/soft-delete-cleanup.ts`, and that is **30** days. So the
 * codebase carried two retention windows, and the one the UI quoted at the
 * user ("Restore is available within 90 days") was the dead one — a promise
 * three times longer than the system keeps. Overstating recoverability on a
 * delete screen is the worst direction to be wrong in.
 *
 * The NAME is back below — re-exported, not redefined, and therefore 30. One
 * constant, one value, one owner.
 *
 * The Delete data screen briefly printed no day count at
 * all — which was the other kind of wrong: "can be brought back from this
 * page", with no window named, reads as an offer that never expires, while a
 * nightly job removes the rows. It prints the window again as of 2026-07-31,
 * DERIVED from `SOFT_DELETE_RETENTION_DAYS` rather than typed into a
 * catalogue, so the copy cannot drift from the cron a second time.
 */
export {
  SOFT_DELETE_TTL_MS,
  SOFT_DELETE_RETENTION_DAYS,
} from "@/lib/cleanup/soft-delete-cleanup"
