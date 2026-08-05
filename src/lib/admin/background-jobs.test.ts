/**
 * 2026-08-04 — the queue page's background-work inventory.
 *
 * The point of these cases is that the monitor must not reassure. Three
 * distinctions carry that weight and are each pinned below:
 *   • on-demand work (recompute, import) never gets a staleness verdict —
 *     "no import for a week" is a fact about the business, not a fault;
 *   • the soft-delete purge is judged only by its own audit heartbeat — never
 *     by the presence of a scheduler in code, which is exactly the assumption
 *     that let it sit unrun for months while the ROADMAP called it done;
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
    lastRecomputeAt: HOURS_AGO(4),
    recomputedLast24h: 120,
    lastImportAt: HOURS_AGO(25),
    lastImportVerdict: "green",
    intelLastRunAt: HOURS_AGO(10),
    feedRefreshLastRunAt: HOURS_AGO(10),
    feedRefreshStatus: "ok",
    feedRefreshErrorCount: 0,
    feedRefreshUnpublishedCount: 0,
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

describe("buildBackgroundJobs — the purge is judged by its heartbeat", () => {
  // Until 2026-08-04 this row was derived from the queue backend flag, which
  // meant it could only ever say "BullMQ is off" — never "the purge has not
  // run". Those are different claims, and the second is the useful one.
  it("reports never when no purge has ever been recorded", () => {
    const jobs = buildBackgroundJobs(input({ lastPurgeAt: null }), NOW)
    expect(byKey(jobs, "softDeletePurge").status).toBe("never")
    expect(byKey(jobs, "softDeletePurge").trigger).toBe("timer")
  })

  it("passes a purge that ran inside its daily window", () => {
    const jobs = buildBackgroundJobs(input({ lastPurgeAt: HOURS_AGO(2) }), NOW)
    expect(byKey(jobs, "softDeletePurge").status).toBe("ok")
  })

  it("flags a purge that has missed two windows", () => {
    const jobs = buildBackgroundJobs(input({ lastPurgeAt: HOURS_AGO(72) }), NOW)
    expect(byKey(jobs, "softDeletePurge").status).toBe("stale")
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
  it("ranks never-run above merely running late", () => {
    expect(
      worstStatus(
        buildBackgroundJobs(
          input({
            lastPurgeAt: HOURS_AGO(1),
            intelLastRunAt: null,
            feedRefreshLastRunAt: HOURS_AGO(200),
          }),
          NOW,
        ),
      ),
    ).toBe("never")
  })

  it("ranks late above untracked", () => {
    expect(
      worstStatus(
        buildBackgroundJobs(
          input({ lastPurgeAt: HOURS_AGO(1), feedRefreshLastRunAt: HOURS_AGO(200) }),
          NOW,
        ),
      ),
    ).toBe("stale")
  })

  it("falls through to untracked when everything scheduled is fine", () => {
    // Never "ok": the trade digest records nothing, so a clean bill of health
    // for the whole page would be a claim the data does not support.
    const jobs = buildBackgroundJobs(input({ lastPurgeAt: HOURS_AGO(1) }), NOW)
    expect(worstStatus(jobs)).toBe("untracked")
  })
})

describe("buildBackgroundJobs — sources that are silent, not broken", () => {
  // 2026-08-05 — the run splits "could not do its job" from "upstream has
  // nothing to publish yet". The split only pays off if the second one stays
  // visible here; otherwise it is hiding, not classifying.
  it("shows the unpublished count as its own line, beside errors", () => {
    const jobs = buildBackgroundJobs(
      input({ feedRefreshErrorCount: 0, feedRefreshUnpublishedCount: 3 }),
      NOW,
    )
    expect(byKey(jobs, "feedRefresh").detail).toEqual([
      { key: "runStatus", value: "ok" },
      { key: "errors", value: "0" },
      { key: "unpublished", value: "3" },
    ])
  })

  it("does not turn a silent upstream into a stale or failing job", () => {
    const jobs = buildBackgroundJobs(
      input({ feedRefreshUnpublishedCount: 12 }),
      NOW,
    )
    expect(byKey(jobs, "feedRefresh").status).toBe("ok")
  })

  it("omits the line entirely when there is nothing unpublished", () => {
    const jobs = buildBackgroundJobs(
      input({ feedRefreshUnpublishedCount: 0 }),
      NOW,
    )
    const keys = byKey(jobs, "feedRefresh").detail.map((d) => d.key)
    expect(keys).not.toContain("unpublished")
  })
})
