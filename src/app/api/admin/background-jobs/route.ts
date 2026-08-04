/**
 * 2026-08-04 — background-work inventory.
 *
 *   GET /api/admin/background-jobs
 *
 * Companion to /api/admin/queue. That route inspects BullMQ; this one
 * answers the question that survives BullMQ being switched off — is the
 * background work actually happening? — by reading the traces the work
 * leaves behind in ordinary tables. No new writes, no new schema.
 *
 * Admin-only, matching the queue inspector: the rows carry import verdicts
 * and feed-refresh error counts, which name companies and sources.
 */
import { NextResponse, type NextRequest } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getLogger } from "@/lib/log"
import { getQueueBackend } from "@/lib/queue/feature-flag"
import { buildBackgroundJobs, worstStatus } from "@/lib/admin/background-jobs"

const logger = getLogger("api:admin-background-jobs")

/** Reads an ISO-ish value out of the org settings JSON. Anything that is
 *  not a parseable date is treated as absent — a monitor that renders
 *  "Invalid Date" as a last-run time is worse than one that says never. */
function settingsDate(
  settings: Record<string, unknown>,
  key: string,
): Date | null {
  const raw = settings[key]
  if (typeof raw !== "string") return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function settingsString(
  settings: Record<string, unknown>,
  key: string,
): string | null {
  const raw = settings[key]
  return typeof raw === "string" ? raw : null
}

function settingsNumber(
  settings: Record<string, unknown>,
  key: string,
): number | null {
  const raw = settings[key]
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await requireRole(req, "admin")
  if (isAuthError(session)) return session

  const now = new Date()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const orgId = session.orgId

  try {
    const data = await withOrgScope(orgId, async (tx) => {
      const [lastIv, recomputedLast24h, lastReport, org, lastPurge] =
        await Promise.all([
          tx.indicatorValue.findFirst({
            where: { organizationId: orgId },
            orderBy: { computedAt: "desc" },
            select: { computedAt: true },
          }),
          tx.indicatorValue.count({
            where: { organizationId: orgId, computedAt: { gte: dayAgo } },
          }),
          tx.importBatchReport.findFirst({
            where: { organizationId: orgId },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true, verdict: true },
          }),
          tx.organization.findUnique({
            where: { id: orgId },
            select: { settings: true },
          }),
          tx.auditEvent.findFirst({
            where: { organizationId: orgId, action: "soft_delete_purge" },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          }),
        ])
      return { lastIv, recomputedLast24h, lastReport, org, lastPurge }
    })

    const settings = (data.org?.settings ?? {}) as Record<string, unknown>
    const jobs = buildBackgroundJobs(
      {
        backend: getQueueBackend(),
        lastRecomputeAt: data.lastIv?.computedAt ?? null,
        recomputedLast24h: data.recomputedLast24h,
        lastImportAt: data.lastReport?.createdAt ?? null,
        lastImportVerdict: data.lastReport?.verdict ?? null,
        intelLastRunAt: settingsDate(settings, "intelLastRunAt"),
        feedRefreshLastRunAt: settingsDate(settings, "feedRefreshLastRunAt"),
        feedRefreshStatus: settingsString(settings, "feedRefreshLastRunStatus"),
        feedRefreshErrorCount: settingsNumber(
          settings,
          "feedRefreshLastRunErrorCount",
        ),
        lastPurgeAt: data.lastPurge?.createdAt ?? null,
      },
      now,
    )

    return NextResponse.json({
      backend: getQueueBackend(),
      generatedAt: now.toISOString(),
      overall: worstStatus(jobs),
      jobs,
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error("background job inventory failed", { reason })
    return NextResponse.json(
      { error: "background job inventory unavailable" },
      { status: 503 },
    )
  }
}
