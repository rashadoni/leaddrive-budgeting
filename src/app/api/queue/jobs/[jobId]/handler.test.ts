/**
 * Phase 12 / A04 (2026-08-02) — the job-status endpoint must fail CLOSED.
 *
 * It read `if (data.organizationId && data.organizationId !== orgId)`, so a
 * job whose payload happened to carry no tenant was readable by any
 * authenticated user of any organization. Nothing about that was hypothetical:
 * BullMQ ids here are guessable (`recomputePair` builds them from
 * org/company/year, `recomputeBatch` takes Redis' sequential counter), and the
 * response carries `failedReason` and `result`.
 *
 * Both queues this route probes declare `organizationId` as REQUIRED
 * (`job-types.ts`), so a job arriving here without one is malformed and the
 * honest answer is to refuse — not to assume it belongs to whoever asked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const getJobPair = vi.fn()
const getJobBatch = vi.fn()
const getSessionMock = vi.fn()
const isBullMqEnabledMock = vi.fn()

vi.mock("@/lib/queue/queues", () => ({
  getQueues: () => ({
    recomputePair: { getJob: getJobPair, name: "recompute-pair" },
    recomputeBatch: { getJob: getJobBatch, name: "recompute-batch" },
  }),
}))
vi.mock("@/lib/queue/feature-flag", () => ({
  isBullMqEnabled: isBullMqEnabledMock,
}))
vi.mock("@/lib/api-auth", () => ({ getSession: getSessionMock }))

const { GET } = await import("./route")

function req() {
  return new NextRequest("http://localhost/api/queue/jobs/42")
}
const ctx = { params: Promise.resolve({ jobId: "42" }) }

function job(data: Record<string, unknown>) {
  return {
    id: "42",
    data,
    getState: async () => "completed",
    progress: 100,
    attemptsMade: 1,
    failedReason: "AZSEKER-EDEN: 12 rows rejected",
    returnvalue: { ok: 7 },
    timestamp: 0,
    processedOn: 1,
    finishedOn: 2,
  }
}

beforeEach(() => {
  getJobPair.mockReset().mockResolvedValue(null)
  getJobBatch.mockReset().mockResolvedValue(null)
  getSessionMock.mockReset().mockResolvedValue({ orgId: "org-mine", userId: "u1" })
  // These cases are all about BullMQ behaviour, so declare the backend on.
  // Without it the route short-circuits to 404 (2026-08-04 — see below).
  isBullMqEnabledMock.mockReset().mockReturnValue(true)
})

describe("GET /api/queue/jobs/[jobId] — tenant boundary", () => {
  it("returns the job when it belongs to the caller's organization", async () => {
    getJobPair.mockResolvedValue(job({ organizationId: "org-mine" }))
    const res = await GET(req(), ctx)
    expect(res.status).toBe(200)
  })

  it("refuses another organization's job", async () => {
    getJobPair.mockResolvedValue(job({ organizationId: "org-theirs" }))
    const res = await GET(req(), ctx)
    expect(res.status).toBe(403)
  })

  it("refuses a job with NO organization rather than treating it as ours", async () => {
    // The whole finding. Under the old `&&` this returned 200, handing over
    // `failedReason` — which names companies — to anyone who guessed an id.
    getJobPair.mockResolvedValue(job({}))
    const res = await GET(req(), ctx)
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain("AZSEKER-EDEN")
  })

  it("refuses an empty-string organization too", async () => {
    getJobPair.mockResolvedValue(job({ organizationId: "" }))
    expect((await GET(req(), ctx)).status).toBe(403)
  })

  it("still 404s an id that exists on neither queue", async () => {
    const res = await GET(req(), ctx)
    expect(res.status).toBe(404)
  })

  it("requires a session at all", async () => {
    getSessionMock.mockResolvedValue(null)
    expect((await GET(req(), ctx)).status).toBe(401)
  })
})

describe("GET /api/queue/jobs/[jobId] — backend off", () => {
  // 2026-08-04 — production runs QUEUE_BACKEND unset and ships no Redis, so
  // probing the queues here dialled 127.0.0.1:6379 and left the module-scoped
  // ioredis client reconnecting forever. With BullMQ off no such job exists.
  it("404s without touching the queues", async () => {
    isBullMqEnabledMock.mockReturnValue(false)
    getJobPair.mockResolvedValue(job({ organizationId: "org-mine" }))
    const res = await GET(req(), ctx)
    expect(res.status).toBe(404)
    expect(getJobPair).not.toHaveBeenCalled()
  })
})
