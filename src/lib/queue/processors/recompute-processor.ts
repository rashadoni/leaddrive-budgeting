/**
 * Phase 6 — BullMQ processor for recompute jobs.
 *
 * Wraps the existing `runRecomputeForCompanies` from
 * `src/lib/risk/recompute-trigger.ts` so the queue layer doesn't need
 * to know anything about indicator catalogues, period scoping, etc.
 *
 * Progress reporting strategy:
 *   • For batch jobs: report 0%, 25%, 50%, 75%, 100% as the underlying
 *     recompute reaches each milestone (companies done / total).
 *   • For pair jobs: report 0% → 100% (single unit of work, can't be
 *     finer-grained without recompute.ts changes).
 *
 * Errors are RE-THROWN so BullMQ's retry + DLQ machinery kicks in
 * (configured in queues.ts default options).
 */
import type { Job } from "bullmq"
import { PrismaClient } from "@prisma/client"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { deserializeImportLineage } from "@/lib/risk/lineage-coverage"
import type {
  RecomputePairJob,
  RecomputeBatchJob,
} from "../job-types"

// One shared Prisma client per worker process. Workers are long-running
// daemons; creating a fresh client per job would exhaust connection
// pool. Workers should set DATABASE_URL with reasonable pool_size.
//
// Phase 8 D5(b) (2026-05-28) — every `runRecomputeForCompanies` call
// now runs inside `withOrgScope(orgId, tx => …)` so the recompute
// resolvers pick up `app.organization_id` at the DB layer. orgId is
// already in the job payload. The chunked batch path opens ONE
// withOrgScope per chunk (not one per job) — long-running tx + Redis
// retry semantics interact better when each chunk is its own
// transaction.
let prismaInstance: PrismaClient | null = null
function getPrisma(): PrismaClient {
  if (!prismaInstance) prismaInstance = new PrismaClient()
  return prismaInstance
}

/** Processor for `recompute-pair` queue. */
export async function processRecomputePair(
  job: Job<RecomputePairJob>,
): Promise<{
  ok: number
  unknown: number
  failed: number
  targets: number
  traced: number
}> {
  const { organizationId, companyId, year } = job.data
  await job.updateProgress(0)
  const result = await withOrgScope(
    organizationId,
    (tx) =>
      runRecomputeForCompanies(tx, organizationId, [{ companyId, year }]),
    { client: getPrisma() },
  )
  await job.updateProgress(100)
  return {
    ok: result.ok,
    unknown: result.unknown,
    failed: result.failed,
    targets: result.targets,
    // Always 0: `RecomputePairJob` carries no lineage. A single-pair refresh is
    // triggered by a UI drill-down, never by an import, so there is no revision
    // it could prove — and this recompute CLEARS whatever pointer the row had,
    // which is correct: it rewrote the value from inputs it cannot attest to.
    traced: result.traced,
  }
}

/** Processor for `recompute-batch` queue.
 *
 *  Splits targets into per-company chunks so progress updates can fire
 *  mid-batch. `runRecomputeForCompanies` already groups internally; we
 *  preserve that grouping while emitting progress every chunk. */
export async function processRecomputeBatch(
  job: Job<RecomputeBatchJob>,
): Promise<{
  ok: number
  unknown: number
  failed: number
  targets: number
  traced: number
}> {
  const { organizationId, targets, lineage: serializedLineage } = job.data
  if (targets.length === 0) {
    await job.updateProgress(100)
    return { ok: 0, unknown: 0, failed: 0, targets: 0, traced: 0 }
  }
  await job.updateProgress(0)

  // Phase 11.86 — rehydrate once, outside the chunk loop. Every chunk gets the
  // SAME lineage object: coverage is keyed by companyId, so a chunk that
  // happens to contain no covered company simply stamps nothing. Chunking must
  // not be able to change what a revision claims.
  const lineage = serializedLineage
    ? deserializeImportLineage(serializedLineage)
    : undefined

  // Chunk by ~5 companies so progress milestones land at predictable
  // intervals even for the 60-company target scale.
  const CHUNK = Math.max(1, Math.ceil(targets.length / 10))
  const aggregate = { ok: 0, unknown: 0, failed: 0, targets: 0, traced: 0 }
  for (let i = 0; i < targets.length; i += CHUNK) {
    const slice = targets.slice(i, i + CHUNK)
    // One withOrgScope per chunk — bounds the open-tx duration to the
    // chunk (5 companies) instead of the whole batch (potentially 60).
    // Lock contention risk on indicator_value upserts stays minimal.
    const result = await withOrgScope(
      organizationId,
      (tx) =>
        runRecomputeForCompanies(
          tx,
          organizationId,
          slice as Array<{ companyId: string; year: number }>,
          {},
          { lineage },
        ),
      { client: getPrisma() },
    )
    aggregate.ok += result.ok
    aggregate.unknown += result.unknown
    aggregate.failed += result.failed
    aggregate.targets += result.targets
    aggregate.traced += result.traced
    const done = Math.min(targets.length, i + slice.length)
    await job.updateProgress(Math.floor((done / targets.length) * 100))
  }
  return aggregate
}
