/**
 * Phase 7.G Turn CVIII (Phase 7.E #1 D.5a bootstrap follow-up) — multi-org
 * scheduler bootstrap helpers.
 *
 * Pure helpers + register/cleanup orchestration so the LXXXX `runScheduledIntelCrawl`
 * scheduler stops being manual-trigger-only. Deployment-side glue
 * (`scripts/intel-scheduler-bootstrap.ts`) constructs Prisma + the runner
 * function and calls `registerSchedulers`. Tests stay pure: no `setInterval`
 * mocking required for the helpers themselves.
 *
 * **Why pure helpers + thin CLI:** keeps unit tests fast (no fake timers),
 * lets the same registration logic be re-used from any host (LaunchAgent +
 * cron + future BullMQ worker). The CLI wrapper is a ~50-LOC shim.
 *
 * **Stagger strategy:** at process start, register each org with an OFFSET
 * delay so 13+ orgs don't all fire `pg_try_advisory_lock` at the same
 * millisecond (thundering herd). Offset = `(orgIndex / orgCount) * intervalMs`.
 * After the initial fire, each org settles into a steady 24h cadence
 * regardless of others. The advisory-lock guard inside `runScheduledIntelCrawl`
 * is the durable dedup mechanism — stagger is just a politeness layer.
 */

import type { PrismaClient } from "@prisma/client"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger default for
// the bootstrap registrar. Replaces `console.error` default sink with
// `intel:scheduler-bootstrap` scope. Callers can still pass a custom
// `opts.logError` (used by tests + alternate hosts).
const log = getLogger("intel:scheduler-bootstrap")

/** Result of org enumeration — narrow shape so tests can build mocks easily. */
export interface ActiveOrg {
  id: string
  slug: string
}

/** Compute the initial-delay (in ms) for an org's setInterval registration so
 *  N orgs spread their first run uniformly across `intervalMs`. */
export function staggerOffsetFor(
  orgIndex: number,
  orgCount: number,
  intervalMs: number,
): number {
  if (orgCount <= 0) return 0
  if (orgIndex < 0 || orgIndex >= orgCount) {
    throw new Error(
      `staggerOffsetFor: orgIndex (${orgIndex}) out of range [0, ${orgCount})`,
    )
  }
  return Math.floor((orgIndex / orgCount) * intervalMs)
}

/** Enumerate orgs that should be on the schedule. Returns ALL orgs by default —
 *  caller can filter via opts (e.g. only orgs with intel-related companies)
 *  in a future follow-up. v1 includes every org. */
export async function enumerateActiveOrgs(
  prisma: Pick<PrismaClient, "organization">,
): Promise<ActiveOrg[]> {
  const rows = await prisma.organization.findMany({
    select: { id: true, slug: true },
    orderBy: { slug: "asc" },
  })
  return rows
}

export type SchedulerRunner = (orgId: string) => Promise<unknown>

export interface RegisterSchedulersOptions {
  /** Per-org interval. Default 24h. */
  intervalMs?: number
  /** Test seam: override `setTimeout`. Default = global. */
  setTimeoutImpl?: typeof setTimeout
  /** Test seam: override `setInterval`. Default = global. */
  setIntervalImpl?: typeof setInterval
  /** Test seam: override `clearTimeout`. Default = global. */
  clearTimeoutImpl?: typeof clearTimeout
  /** Test seam: override `clearInterval`. Default = global. */
  clearIntervalImpl?: typeof clearInterval
  /** Optional logger. Default: structured `intel:scheduler-bootstrap`
   *  logger for failures only (no info-level noise — failures matter;
   *  successes are recorded by the scheduler itself in IntelItem rows +
   *  audit_event). */
  logError?: (msg: string, err: unknown) => void
}

export interface RegisterSchedulersResult {
  /** Stop all timers. Idempotent. */
  cleanup: () => void
  /** Number of orgs registered. */
  orgCount: number
  /** Per-org first-fire offset in ms (for forensics + tests). */
  staggerSchedule: Array<{ orgId: string; offsetMs: number }>
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Register a daily-interval scheduler per org. Returns a `cleanup` function
 * that clears all pending timers. Pure orchestration — caller supplies the
 * runner function (typically `(orgId) => runScheduledIntelCrawl(prisma, orgId, {...})`).
 *
 * Failure handling: each runner invocation is wrapped in a Promise.catch
 * that logs (via opts.logError) and swallows so one org's crash doesn't
 * break the whole scheduler. The advisory lock + `tryPrismaThenFallback`
 * already make the runner idempotent + crash-safe at the storage level.
 */
export function registerSchedulers(
  orgs: ReadonlyArray<ActiveOrg>,
  runner: SchedulerRunner,
  opts: RegisterSchedulersOptions = {},
): RegisterSchedulersResult {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const setT = opts.setTimeoutImpl ?? setTimeout
  const setI = opts.setIntervalImpl ?? setInterval
  const clearT = opts.clearTimeoutImpl ?? clearTimeout
  const clearI = opts.clearIntervalImpl ?? clearInterval
  const logError = opts.logError ?? ((msg, err) => log.error(msg, {
    err: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  }))

  const timeoutHandles: ReturnType<typeof setTimeout>[] = []
  const intervalHandles: ReturnType<typeof setInterval>[] = []
  const staggerSchedule: Array<{ orgId: string; offsetMs: number }> = []

  const safeRun = async (orgId: string) => {
    try {
      await runner(orgId)
    } catch (err) {
      logError(`[intel-scheduler-bootstrap] runner threw for org=${orgId}:`, err)
    }
  }

  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i]
    const offsetMs = staggerOffsetFor(i, orgs.length, intervalMs)
    staggerSchedule.push({ orgId: org.id, offsetMs })

    // Initial fire after the stagger offset, then steady interval
    const initialHandle = setT(() => {
      void safeRun(org.id)
      const intervalHandle = setI(() => {
        void safeRun(org.id)
      }, intervalMs)
      intervalHandles.push(intervalHandle)
    }, offsetMs)
    timeoutHandles.push(initialHandle)
  }

  let cleanedUp = false
  const cleanup = (): void => {
    if (cleanedUp) return
    cleanedUp = true
    for (const h of timeoutHandles) clearT(h)
    for (const h of intervalHandles) clearI(h)
  }

  return { cleanup, orgCount: orgs.length, staggerSchedule }
}
