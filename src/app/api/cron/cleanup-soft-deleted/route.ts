/**
 * 2026-08-04 — soft-delete physical purge, reachable without BullMQ.
 *
 *   GET /api/cron/cleanup-soft-deleted
 *
 * Phase 1.4 shipped this purge as a BullMQ job and the ROADMAP marked it done.
 * The background-work monitor showed the other half: its only scheduler is
 * `scheduleCleanupCron()`, reachable only from the worker process, and that
 * process is deployed nowhere — no compose service, Dockerfile stage, systemd
 * unit or crontab entry. So rows soft-deleted over 30 days ago were never
 * actually removed on the one deployment that exists.
 *
 * The owner's call was to leave BullMQ off, so this exposes the same work over
 * the same channel the other two scheduled jobs already use: a systemd timer
 * calling a CRON_SECRET-authed endpoint. `deploy/systemd/budgetpro-cleanup-
 * soft-deleted.{service,timer}` runs it at 03:00 UTC, matching the schedule
 * the BullMQ path would have used (`CLEANUP_DEFAULT_CRON`).
 *
 * Auth: Bearer CRON_SECRET, constant-time compare, fails CLOSED when the
 * secret is unset — identical to the sibling cron routes. This one deletes
 * rows, so "refuse when unconfigured" is the only acceptable direction.
 */
// rls-scan-ignore: CRON_SECRET-authed maintenance job that legitimately spans
// ALL organizations — the retention window is a deployment-wide policy, not a
// tenant setting, and `withOrgScope` pins exactly one org context. Runs on the
// BYPASSRLS `prismaAdmin` client, exactly as the BullMQ processor did.
import { NextResponse, type NextRequest } from "next/server"
import { prismaAdmin } from "@/lib/db/prisma-admin"
import { bearerMatches } from "@/lib/cron-auth"
import { getLogger } from "@/lib/log"
import { runPurge } from "@/lib/cleanup/purge-run"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const log = getLogger("cron:cleanup-soft-deleted")

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Fail closed. An unauthenticated endpoint that hard-deletes financial
    // rows is not a degraded mode worth having.
    log.error("CRON_SECRET is not set — refusing to run the purge")
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    )
  }
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runPurge(prismaAdmin)
    return NextResponse.json({
      ok: true,
      counts: result.counts,
      cutoffDays: result.cutoffDays,
      durationMs: result.durationMs,
      // Null means the purge ran but its audit event did not persist. The
      // monitor reads that event as the heartbeat, so it will keep reporting
      // the job as not-run — surfaced here so the timer's log says why.
      auditEventId: result.auditEventId,
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.error("purge failed", { reason })
    return NextResponse.json({ error: "purge failed", reason }, { status: 500 })
  }
}
