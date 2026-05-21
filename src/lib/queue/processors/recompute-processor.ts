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
import type {
  RecomputePairJob,
  RecomputeBatchJob,
} from "../job-types"

// One shared Prisma client per worker process. Workers are long-running
// daemons; creating a fresh client per job would exhaust connection
// pool. Workers should set DATABASE_URL with reasonable pool_size.
//
// Phase 5.2 Stage 2 RLS rollout note (2026-05-21): when per-table RLS
// migrations land, `runRecomputeForCompanies` callers from THIS
// processor will need to wrap individual writes in
// `withOrgScope(job.data.organizationId, ...)` — the orgId is already
// in the job payload. Until the per-table migrations apply, the
// processor uses the regular prisma client and writes ignore RLS
// (table-level RLS is OFF). See docs/RLS_PATTERN_EXAMPLE.md.
let prismaInstance: PrismaClient | null = null
function getPrisma(): PrismaClient {
  if (!prismaInstance) prismaInstance = new PrismaClient()
  return prismaInstance
}

/** Processor for `recompute-pair` queue. */
export async function processRecomputePair(
  job: Job<RecomputePairJob>,
): Promise<{ ok: number; unknown: number; failed: number; targets: number }> {
  const { organizationId, companyId, year } = job.data
  await job.updateProgress(0)
  const result = await runRecomputeForCompanies(
    getPrisma(),
    organizationId,
    [{ companyId, year }],
  )
  await job.updateProgress(100)
  return {
    ok: result.ok,
    unknown: result.unknown,
    failed: result.failed,
    targets: result.targets,
  }
}

/** Processor for `recompute-batch` queue.
 *
 *  Splits targets into per-company chunks so progress updates can fire
 *  mid-batch. `runRecomputeForCompanies` already groups internally; we
 *  preserve that grouping while emitting progress every chunk. */
export async function processRecomputeBatch(
  job: Job<RecomputeBatchJob>,
): Promise<{ ok: number; unknown: number; failed: number; targets: number }> {
  const { organizationId, targets } = job.data
  if (targets.length === 0) {
    await job.updateProgress(100)
    return { ok: 0, unknown: 0, failed: 0, targets: 0 }
  }
  await job.updateProgress(0)

  // Chunk by ~5 companies so progress milestones land at predictable
  // intervals even for the 60-company target scale.
  const CHUNK = Math.max(1, Math.ceil(targets.length / 10))
  const aggregate = { ok: 0, unknown: 0, failed: 0, targets: 0 }
  for (let i = 0; i < targets.length; i += CHUNK) {
    const slice = targets.slice(i, i + CHUNK)
    const result = await runRecomputeForCompanies(
      getPrisma(),
      organizationId,
      slice as Array<{ companyId: string; year: number }>,
    )
    aggregate.ok += result.ok
    aggregate.unknown += result.unknown
    aggregate.failed += result.failed
    aggregate.targets += result.targets
    const done = Math.min(targets.length, i + slice.length)
    await job.updateProgress(Math.floor((done / targets.length) * 100))
  }
  return aggregate
}
