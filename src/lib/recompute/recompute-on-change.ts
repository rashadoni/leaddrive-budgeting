import { prisma } from "@/lib/prisma"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"
import { getLogger } from "@/lib/log"

const log = getLogger("recompute:on-change")

/**
 * Recompute a company's indicators for `year` right after a data change
 * (manual KPI entry, feed ingest) so the dependent indicators reflect the new
 * value immediately instead of waiting for the next batch run.
 *
 * Design:
 *  - **Synchronous** (the caller awaits): serverless (Vercel) freezes the
 *    function after the HTTP response, so fire-and-forget recompute work would
 *    be silently killed. Awaiting before responding is the only reliable path.
 *  - **Best-effort**: a recompute failure must NEVER roll back the data write —
 *    the row is already committed; stale IVs self-heal on the next run. Errors
 *    are logged + swallowed.
 *
 * Reuses `runRecomputeForCompanies` (the canonical refresher) — recomputes all
 * of the company's annual indicators for the year (idempotent for the ones the
 * change didn't touch).
 */
export async function recomputeAfterDataChange(
  organizationId: string,
  companyId: string,
  year: number,
): Promise<{ ok: number; unknown: number; failed: number } | null> {
  try {
    const r = await runRecomputeForCompanies(prisma, organizationId, [
      { companyId, year },
    ])
    log.info("recompute-on-change done", {
      companyId,
      year,
      ok: r.ok,
      unknown: r.unknown,
      failed: r.failed,
    })
    return { ok: r.ok, unknown: r.unknown, failed: r.failed }
  } catch (err) {
    log.error("recompute-on-change failed (non-fatal; row already saved)", {
      companyId,
      year,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
