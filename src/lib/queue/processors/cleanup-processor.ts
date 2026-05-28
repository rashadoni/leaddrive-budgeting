/**
 * Phase 1.4 (closed 2026-05-26) — BullMQ processor for the daily
 * soft-delete physical-purge cron.
 *
 * Reads job payload, calls the pure helper, emits one audit event
 * summarising the per-table counts. Never throws — a DB failure during
 * cleanup bubbles up to BullMQ's retry policy (attempts=2 per
 * queues.ts), and audit-log emission errors are swallowed so they
 * don't reverse the actual cleanup.
 *
 * Multi-org note: today this runs as a single system-wide pass with
 * one audit event attributed to the first active organization (or the
 * explicit `organizationId` from job payload). When org-isolated
 * scheduling lands (Phase 6 multi-tenant scheduler), the payload's
 * `organizationId` becomes mandatory and the helper gains a `where`
 * clause.
 */

import type { Job } from "bullmq"
import type { CleanupSoftDeletedJob } from "../job-types"
import {
  runSoftDeleteCleanup,
  SOFT_DELETE_TTL_MS,
  type CleanupCounts,
} from "../../cleanup/soft-delete-cleanup"
import { logAuditEvent } from "../../audit/log"
import { prisma } from "../../prisma"
import { getLogger } from "../../log"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("queue:cleanup-processor")

export interface CleanupProcessorResult {
  counts: CleanupCounts
  durationMs: number
  cutoffDays: number
  auditEventId: string | null
}

export async function processCleanupSoftDeleted(
  job: Job<CleanupSoftDeletedJob>,
): Promise<CleanupProcessorResult> {
  const startedAt = Date.now()
  const cutoffMs = job.data.cutoffMs ?? SOFT_DELETE_TTL_MS
  const cutoffDays = Math.round(cutoffMs / (24 * 60 * 60 * 1000))

  const counts = await runSoftDeleteCleanup(prisma, { cutoffMs })
  const durationMs = Date.now() - startedAt

  // Audit event — attribute to the explicit payload org, else the
  // first active org. Single-org deployments today; multi-tenant
  // bootstrap will pass `organizationId` per scheduled fan-out.
  let orgId = job.data.organizationId
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
