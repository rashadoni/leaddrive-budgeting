/**
 * 2026-08-04 — background-work inventory for the admin queue page.
 *
 * BullMQ is switched off in production (QUEUE_BACKEND=inprocess, no Redis,
 * no worker container), so the queue inspector had nothing to inspect and
 * the page said so and stopped. That is honest but useless: work still runs
 * in production, it just does not run through a queue. This module answers
 * the question the page is actually there to answer — *is the background
 * work happening?* — from traces the work already leaves in the database.
 *
 * Deliberately evidence-first. Every row names the column it was derived
 * from, and a job that leaves no trace is reported as `untracked` rather
 * than given a reassuring green tick. The alternative — inferring "it must
 * have run" from a crontab entry — is how a monitor starts lying.
 *
 * Pure: no Prisma, no clock. The route supplies both, tests supply neither.
 */

/** How the work is set in motion in production. */
export type JobTrigger =
  /** Runs inside the HTTP request that asked for it (no scheduler). */
  | "request"
  /** systemd timer on the production host hits a /api/cron/* route. */
  | "timer"
  /** crontab entry on the production host. */
  | "cron"
  /** Scheduled inside the BullMQ worker process. */
  | "worker"

export type JobStatus =
  /** Ran within the window its schedule implies. */
  | "ok"
  /** Has run before, but longer ago than its schedule allows. */
  | "stale"
  /** Scheduled work that has never left a trace. */
  | "never"
  /** Only a user can start it; recency is information, not a verdict. */
  | "onDemand"
  /** Its only scheduler lives in the BullMQ worker, which is not running. */
  | "noRunner"
  /** Runs, but records nothing we can read back. Not a pass. */
  | "untracked"

export interface BackgroundJob {
  /** Stable key — also the i18n key for name + description. */
  key: string
  trigger: JobTrigger
  status: JobStatus
  /** ISO string, or null when there is no trace. */
  lastRunAt: string | null
  /** Whole minutes since lastRunAt; null when there is no trace. */
  ageMinutes: number | null
  /** The column this row was read from — so a reader can go check. */
  evidence: string
  /** Extra facts worth showing next to the row. Values are pre-formatted. */
  detail: Array<{ key: string; value: string }>
}

export interface BackgroundJobsInput {
  backend: "bullmq" | "inprocess"
  /** max(indicator_values.computedAt) */
  lastRecomputeAt: Date | null
  /** count(indicator_values) computed in the last 24h */
  recomputedLast24h: number
  /** max(import_batch_reports.createdAt) */
  lastImportAt: Date | null
  /** verdict of that most recent import report ("green" | "yellow" | "red") */
  lastImportVerdict: string | null
  /** Organization.settings.intelLastRunAt */
  intelLastRunAt: Date | null
  /** Organization.settings.feedRefreshLastRunAt */
  feedRefreshLastRunAt: Date | null
  /** Organization.settings.feedRefreshLastRunStatus */
  feedRefreshStatus: string | null
  /** Organization.settings.feedRefreshLastRunErrorCount */
  feedRefreshErrorCount: number | null
  /** max(audit_events.createdAt) where action = soft_delete_purge */
  lastPurgeAt: Date | null
}

/** A daily job is late once it has missed two of its own windows — one
 *  missed run is a blip (host reboot, deploy), two is a pattern. */
const DAILY_STALE_AFTER_MINUTES = 48 * 60

function minutesSince(then: Date, now: Date): number {
  return Math.floor((now.getTime() - then.getTime()) / 60_000)
}

/** Verdict for scheduled work: never run → `never`, run too long ago →
 *  `stale`, otherwise `ok`. */
function scheduledStatus(
  lastRunAt: Date | null,
  now: Date,
  staleAfterMinutes: number,
): JobStatus {
  if (!lastRunAt) return "never"
  return minutesSince(lastRunAt, now) > staleAfterMinutes ? "stale" : "ok"
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

function age(d: Date | null, now: Date): number | null {
  return d ? minutesSince(d, now) : null
}

/**
 * Build the inventory. `now` is injected so the staleness verdicts are
 * reproducible in tests.
 */
export function buildBackgroundJobs(
  input: BackgroundJobsInput,
  now: Date,
): BackgroundJob[] {
  const jobs: BackgroundJob[] = []

  // ── Indicator recompute ───────────────────────────────────────────────
  // Runs inside POST /api/indicators. Nobody schedules it, so "it has not
  // run for a week" means "nobody imported anything for a week" — a fact,
  // not a fault. Hence onDemand rather than a staleness verdict.
  jobs.push({
    key: "recompute",
    trigger: "request",
    status: "onDemand",
    lastRunAt: iso(input.lastRecomputeAt),
    ageMinutes: age(input.lastRecomputeAt, now),
    evidence: "indicator_values.computedAt",
    detail: [{ key: "recomputedLast24h", value: String(input.recomputedLast24h) }],
  })

  // ── Data import ───────────────────────────────────────────────────────
  jobs.push({
    key: "import",
    trigger: "request",
    status: "onDemand",
    lastRunAt: iso(input.lastImportAt),
    ageMinutes: age(input.lastImportAt, now),
    evidence: "import_batch_reports.createdAt",
    detail: input.lastImportVerdict
      ? [{ key: "verdict", value: input.lastImportVerdict }]
      : [],
  })

  // ── Intel crawl (systemd timer → /api/cron/intel-crawl) ───────────────
  jobs.push({
    key: "intelCrawl",
    trigger: "timer",
    status: scheduledStatus(input.intelLastRunAt, now, DAILY_STALE_AFTER_MINUTES),
    lastRunAt: iso(input.intelLastRunAt),
    ageMinutes: age(input.intelLastRunAt, now),
    evidence: "Organization.settings.intelLastRunAt",
    detail: [],
  })

  // ── Free-feed refresh (systemd timer → /api/cron/refresh-feeds) ───────
  const feedDetail: Array<{ key: string; value: string }> = []
  if (input.feedRefreshStatus) {
    feedDetail.push({ key: "runStatus", value: input.feedRefreshStatus })
  }
  if (input.feedRefreshErrorCount !== null) {
    feedDetail.push({ key: "errors", value: String(input.feedRefreshErrorCount) })
  }
  jobs.push({
    key: "feedRefresh",
    trigger: "timer",
    status: scheduledStatus(
      input.feedRefreshLastRunAt,
      now,
      DAILY_STALE_AFTER_MINUTES,
    ),
    lastRunAt: iso(input.feedRefreshLastRunAt),
    ageMinutes: age(input.feedRefreshLastRunAt, now),
    evidence: "Organization.settings.feedRefreshLastRunAt",
    detail: feedDetail,
  })

  // ── Trade alert digest (crontab → /api/cron/trade-digest) ─────────────
  // It is in the production crontab, and it writes nothing we can read
  // back — no heartbeat, no audit event. So it gets `untracked`, not `ok`:
  // the honest report is "we cannot tell", and the fix is a heartbeat.
  jobs.push({
    key: "tradeDigest",
    trigger: "cron",
    status: "untracked",
    lastRunAt: null,
    ageMinutes: null,
    evidence: "—",
    detail: [],
  })

  // ── Soft-delete physical purge ────────────────────────────────────────
  // `scheduleCleanupCron()` is called from worker-factory.ts, which only
  // runs inside scripts/run-worker.ts — and that process is deployed
  // nowhere (it appears in no Dockerfile, compose service or unit file).
  // With the backend in-process the 30-day purge therefore has no runner
  // at all, which is exactly the kind of silence a monitor exists to break.
  jobs.push({
    key: "softDeletePurge",
    trigger: "worker",
    status:
      input.backend === "bullmq"
        ? scheduledStatus(input.lastPurgeAt, now, DAILY_STALE_AFTER_MINUTES)
        : "noRunner",
    lastRunAt: iso(input.lastPurgeAt),
    ageMinutes: age(input.lastPurgeAt, now),
    evidence: "audit_events(action=soft_delete_purge).createdAt",
    detail: [],
  })

  return jobs
}

/** Worst status present, for the page's summary pill. Order matters: a
 *  job with no runner is a bigger problem than one merely running late. */
const SEVERITY: JobStatus[] = [
  "noRunner",
  "never",
  "stale",
  "untracked",
  "onDemand",
  "ok",
]

export function worstStatus(jobs: BackgroundJob[]): JobStatus {
  for (const s of SEVERITY) {
    if (jobs.some((j) => j.status === s)) return s
  }
  return "ok"
}
