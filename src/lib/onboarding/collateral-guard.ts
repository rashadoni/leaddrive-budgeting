/**
 * Collateral-deletion guard for the import "clean-slate" pattern.
 *
 * Every import batch soft/hard-deletes the existing rows in scope and
 * then re-inserts the parsed rows. The DELETE scope is hand-written per
 * batch function and MUST stay confined to the import's own footprint —
 * the identity-keys (plan / company / source-entity / metric) that the
 * INSERTED rows actually carry. Historically that scope drifted broader
 * than the footprint and silently wiped SIBLING data:
 *
 *   • 2026-06-11 — BudgetLine: archive scoped by org+company+YEAR (no
 *     planId) wiped the 2026 BUDGET plan when importing the 2026 ACTUALS
 *     plan (same company, same year) — 2700 lines lost.
 *   • 2026-05-31 — BalanceSheetLine / CashFlowEntry: archive scoped by
 *     plan-only / shared-sourceTag wiped sibling ENTITIES — only the last
 *     entity in a multi-entity import survived (e.g. 37 of 309 CF rows).
 *
 * Each fix was a point-fix to one missing identity dimension. This guard
 * is the table-agnostic NET that makes the whole class loud instead of
 * silent: after the archive, the caller passes how many rows were
 * archived AND an independently-computed count of how many LIVE rows
 * actually fall within the import's own footprint. If the archive removed
 * MORE than the footprint, the reset scope over-reached — throw so the
 * surrounding transaction rolls back and no sibling data is lost.
 *
 * The footprint count MUST be derived from the INSERTED rows' identity,
 * NOT from the same scope the archive WHERE uses — otherwise the check is
 * circular and can never fire. See the call sites in import-batch.ts /
 * bs-import-batch.ts / cf-import-batch.ts / kpi-import-batch.ts.
 */

/** Thrown when a clean-slate archive removed rows outside the import's
 *  own footprint. Propagates out of the write transaction so it rolls
 *  back — the caller surfaces it as a failed import (no partial state). */
export class CollateralDeletionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CollateralDeletionError"
  }
}

/**
 * Assert a clean-slate archive stayed within the import's own footprint.
 *
 * @param table                 Human label for the error (e.g. "BudgetLine").
 * @param archivedCount         Rows the archive step actually removed (the
 *                              `updateMany`/`deleteMany` count).
 * @param footprintLiveCount    Live rows within the import's OWN footprint,
 *                              counted independently from the inserted rows'
 *                              identity keys.
 * @param footprint             Short description of the footprint, for the
 *                              error message (e.g. "plans=[p1] companies=[c1]").
 * @throws CollateralDeletionError when `archivedCount > footprintLiveCount`.
 */
export function assertNoCollateralDeletion(args: {
  table: string
  archivedCount: number
  footprintLiveCount: number
  footprint: string
}): void {
  const { table, archivedCount, footprintLiveCount, footprint } = args
  if (archivedCount > footprintLiveCount) {
    throw new CollateralDeletionError(
      `[clean-slate guard] ${table}: archived ${archivedCount} live row(s) but only ` +
        `${footprintLiveCount} are within this import's own footprint (${footprint}). ` +
        `The reset scope is BROADER than what this import writes — aborting to prevent ` +
        `sibling data loss. Likely cause: the archive WHERE clause is missing an identity ` +
        `dimension (planId / companyId / sourceId / metric).`,
    )
  }
}
