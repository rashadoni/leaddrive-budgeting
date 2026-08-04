/**
 * 2026-08-04 — the soft-delete purge, separated from the thing that starts it.
 *
 * Phase 1.4 shipped this as a BullMQ processor and marked the item closed. The
 * background-work monitor then showed why that was only half true: the purge is
 * scheduled by `scheduleCleanupCron()`, which is reachable only from
 * `worker-factory.ts`, which runs only inside `scripts/run-worker.ts` — and
 * that process is deployed nowhere. No compose service, no Dockerfile stage, no
 * systemd unit, no crontab entry. So on the only deployment that exists, rows
 * soft-deleted more than 30 days ago were never physically removed.
 *
 * The owner's call was to leave BullMQ off, so the fix is to stop coupling the
 * work to the queue: the run-and-audit body lives here, and both the BullMQ
 * processor and the new `/api/cron/cleanup-soft-deleted` route call it. Neither
 * caller owns the logic, and adding a third scheduler later costs one call.
 */
import type { PrismaClient } from "@prisma/client"
import {
  runSoftDeleteCleanup,
  SOFT_DELETE_TTL_MS,
  type CleanupCounts,
} from "./soft-delete-cleanup"
import { logAuditEvent } from "../audit/log"
import { getLogger } from "../log"

const log = getLogger("cleanup:purge")

export interface PurgeRunResult {
  counts: CleanupCounts
  durationMs: number
  cutoffDays: number
  auditEventId: string | null
}

export interface PurgeRunOptions {
  /** Retention window. Defaults to the 30-day `SOFT_DELETE_TTL_MS`. */
  cutoffMs?: number
  /** Org to attribute the audit event to. Defaults to the oldest active one —
   *  single-org deployments today; a multi-tenant scheduler will pass it. */
  organizationId?: string
}

/**
 * Physically remove rows soft-deleted before the cutoff and record one audit
 * event describing what went.
 *
 * The audit write is best-effort by design: it must never reverse a cleanup
 * that already happened. A failed event leaves `auditEventId` null, and the
 * monitor then reports the purge as if it had not run — which is the safe
 * direction to be wrong in, because it prompts a look rather than a shrug.
 */
export async function runPurge(
  prisma: PrismaClient,
  options: PurgeRunOptions = {},
): Promise<PurgeRunResult> {
  const startedAt = Date.now()
  const cutoffMs = options.cutoffMs ?? SOFT_DELETE_TTL_MS
  const cutoffDays = Math.round(cutoffMs / (24 * 60 * 60 * 1000))

  const counts = await runSoftDeleteCleanup(prisma, { cutoffMs })
  const durationMs = Date.now() - startedAt

  let orgId = options.organizationId
  if (!orgId) {
    const firstOrg = await prisma.organization.findFirst({
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })
    orgId = firstOrg?.id
  }

  let auditEventId: string | null = null
  if (orgId) {
    const result = await logAuditEvent(prisma, {
      organizationId: orgId,
      actorUserId: null, // system event
      event: {
        action: "soft_delete_purge",
        entityType: "Organization",
        entityId: orgId,
        metadata: {
          counts,
          cutoffDays,
          durationMs,
        },
      },
    })
    if (result.ok) auditEventId = result.id
  }

  log.info("purged soft-deleted rows", {
    total: counts.total,
    budgetPlans: counts.budgetPlans,
    cashFlowEntries: counts.cashFlowEntries,
    balanceSheetLines: counts.balanceSheetLines,
    counterparties: counts.counterparties,
    durationMs,
    cutoffDays,
  })

  return { counts, durationMs, cutoffDays, auditEventId }
}
