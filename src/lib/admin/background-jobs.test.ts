/**
 * 2026-08-04 — the queue page's background-work inventory.
 *
 * The point of these cases is that the monitor must not reassure. Three
 * distinctions carry that weight and are each pinned below:
 *   • on-demand work (recompute, import) never gets a staleness verdict —
 *     "no import for a week" is a fact about the business, not a fault;
 *   • the soft-delete purge reports `noRunner` while BullMQ is off, because
 *     its only scheduler lives in a worker process production never starts;
 *   • the trade digest reports `untracked`, not `ok` — it is in the crontab
 *     but records nothing, so "did it run?" has no honest answer yet.
 */
import { describe, it, expect } from "vitest"
import {
  buildBackgroundJobs,
  worstStatus,
  type BackgroundJobsInput,
} from "./background-jobs"

const NOW = new Date("2026-08-04T18:00:00.000Z")
const HOURS_AGO = (h: number) =>
  new Date(NOW.getTime() - h * 60 * 60 * 1000)

function input(over: Partial<BackgroundJobsInput> = {}): BackgroundJobsInput {
  return {
    backend: "inprocess",
    lastRecomputeAt: HOURS_AGO(4),
    recomputedLast24h: 120,
    lastImportAt: HOURS_AGO(25),
    lastImportVerdict: "green",
    intelLastRunAt: HOURS_AGO(10),
    feedRefreshLastRunAt: HOURS_AGO(10),
    feedRefreshStatus: "ok",
    feedRefreshErrorCount: 0,
    lastPurgeAt: null,
    ...over,
  }
}

const byKey = (jobs: ReturnType<typeof buildBackgroundJobs>, key: string) => {
  const j = jobs.find((x) => x.key === key)
  if (!j) throw new Error(`no job ${key}`)
  return j
}

describe("buildBackgroundJobs — scheduled work", () => {
  it("passes a timer job that ran inside its window", () => {
    const j = byKey(buildBackgroundJobs(input(), NOW), "intelCrawl")
    expect(j.status).toBe("ok")
    expect(j.ageMinutes).toBe(600)
  })

  it("flags a timer job that missed two daily windows", () => {
    const jobs = buildBackgroundJobs(
      input({ intelLastRunAt: HOURS_AGO(49) }),
      NOW,
    )
    expect(byKey(jobs, "intelCrawl").status).toBe("stale")
  })

  it("tolerates a single missed window — one blip is not an incident", () => {
    const jobs = buildBackgroundJobs(
      input({ intelLastRunAt: HOURS_AGO(47) }),
      NOW,
    )
    expect(byKey(jobs, "intelCrawl").status).toBe("ok")
  })

  it("reports a timer that has never left a trace as never, not stale", () => {
    const jobs = buildBackgroundJobs(input({ intelLastRunAt: null }), NOW)
    const j = byKey(jobs, "intelCrawl")
    expect(j.status).toBe("never")
    expect(j.lastRunAt).toBeNull()
    expect(j.ageMinutes).toBeNull()
  })
})

describe("buildBackgroundJobs — on-demand work", () => {
  it("never calls a user-triggered job stale, however old", () => {
    const jobs = buildBackgroundJobs(
      input({ lastRecomputeAt: HOURS_AGO(24 * 90), lastImportAt: null }),
      NOW,
    )
    expect(byKey(jobs, "recompute").status).toBe("onDemand")
    expect(byKey(jobs, "import").status).toBe("onDemand")
  })

  it("carries the 24h recompute count and the last import verdict", () => {
    const jobs = buildBackgroundJobs(
      input({ recomputedLast24h: 252, lastImportVerdict: "yellow" }),
      NOW,
    )
    expect(byKey(jobs, "recompute").detail).toEqual([
      { key: "recomputedLast24h", value: "252" },
    ])
    expect(byKey(jobs, "import").detail).toEqual([
      { key: "verdict", value: "yellow" },
    ])
  })

  it("omits the verdict row when no import has ever run", () => {
    const jobs = buildBackgroundJobs(
      input({ lastImportAt: null, lastImportVerdict: null }),
      NOW,
    )
    expect(byKey(jobs, "import").detail).toEqual([])
  })
})

describe("buildBackgroundJobs — the purge has no runner", () => {
  it("reports noRunner while the backend is in-process", () => {
    const jobs = buildBackgroundJobs(input({ backend: "inprocess" }), NOW)
    expect(byKey(jobs, "softDeletePurge").status).toBe("noRunner")
  })

  it("stays noRunner even if an old purge event exists", () => {
    // A purge that ran once on a dev box must not read as "healthy" on a
    // deployment where nothing schedules it any more.
    const jobs = buildBackgroundJobs(
      input({ backend: "inprocess", lastPurgeAt: HOURS_AGO(2) }),
      NOW,
    )
    expect(byKey(jobs, "softDeletePurge").status).toBe("noRunner")
  })

  it("judges it normally once BullMQ is actually the backend", () => {
    const fresh = buildBackgroundJobs(
      input({ backend: "bullmq", lastPurgeAt: HOURS_AGO(2) }),
      NOW,
    )
    expect(byKey(fresh, "softDeletePurge").status).toBe("ok")
    const old = buildBackgroundJobs(
      input({ backend: "bullmq", lastPurgeAt: HOURS_AGO(72) }),
      NOW,
    )
    expect(byKey(old, "softDeletePurge").status).toBe("stale")
    const none = buildBackgroundJobs(
      input({ backend: "bullmq", lastPurgeAt: null }),
      NOW,
    )
    expect(byKey(none, "softDeletePurge").status).toBe("never")
  })
})

describe("buildBackgroundJobs — work that records nothing", () => {
  it("reports the trade digest as untracked rather than ok", () => {
    const j = byKey(buildBackgroundJobs(input(), NOW), "tradeDigest")
    expect(j.status).toBe("untracked")
    expect(j.lastRunAt).toBeNull()
  })
})

describe("buildBackgroundJobs — every row names its evidence", () => {
  it("gives a readable source for anything it claims to know", () => {
    for (const j of buildBackgroundJobs(input(), NOW)) {
      expect(j.evidence.length).toBeGreaterThan(0)
      // A row that claims a timestamp must say where the timestamp is from.
      if (j.lastRunAt) expect(j.evidence).not.toBe("—")
    }
  })
})

describe("worstStatus", () => {
  it("ranks a missing runner above merely running late", () => {
    const jobs = buildBackgroundJobs(
      input({ backend: "inprocess", intelLastRunAt: HOURS_AGO(200) }),
      NOW,
    )
    expect(worstStatus(jobs)).toBe("noRunner")
  })

  it("ranks never-run above late, and late above untracked", () => {
    expect(
      worstStatus(
        buildBackgroundJobs(
          input({
            backend: "bullmq",
            lastPurgeAt: HOURS_AGO(1),
            intelLastRunAt: null,
            feedRefreshLastRunAt: HOURS_AGO(200),
          }),
          NOW,
        ),
      ),
    ).toBe("never")
    expect(
      worstStatus(
        buildBackgroundJobs(
          input({ backend: "bullmq", lastPurgeAt: HOURS_AGO(1), feedRefreshLastRunAt: HOURS_AGO(200) }),
          NOW,
        ),
      ),
    ).toBe("stale")
  })

  it("falls through to untracked when everything else is fine", () => {
    const jobs = buildBackgroundJobs(
      input({ backend: "bullmq", lastPurgeAt: HOURS_AGO(1) }),
      NOW,
    )
    expect(worstStatus(jobs)).toBe("untracked")
  })
})
