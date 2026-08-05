/**
 * 2026-08-04 — /budgeting/admin/queue answered HTTP 500 on production.
 *
 * The route called `getQueues()` unconditionally. Production runs with
 * QUEUE_BACKEND unset (→ `inprocess`) and its compose stack has no Redis
 * service, so ioredis dialled 127.0.0.1:6379, ECONNREFUSED escaped the
 * handler, and the admin page rendered a bare "❌ HTTP 500". The dialling
 * itself was the more expensive half: the ioredis singleton is module-scoped
 * with an unbounded retryStrategy, so a single page visit left the app
 * process reconnecting — and logging — forever.
 *
 * These tests pin the two halves of the fix: with the backend off the route
 * must answer without touching Redis at all, and with it on a Redis outage
 * must surface as a 503 carrying its reason rather than a 500.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const getQueuesMock = vi.fn()
const requireRoleMock = vi.fn()
const isBullMqEnabledMock = vi.fn()

vi.mock("@/lib/queue/queues", () => ({ getQueues: getQueuesMock }))
vi.mock("@/lib/queue/feature-flag", () => ({
  isBullMqEnabled: isBullMqEnabledMock,
}))
vi.mock("@/lib/api-auth", () => ({
  requireRole: requireRoleMock,
  isAuthError: (v: unknown) => v instanceof Response,
}))

const { GET } = await import("./route")

function req(state = "active") {
  return new NextRequest(`http://localhost/api/admin/queue?state=${state}`)
}

/** A queue whose getJobs returns one job owned by the caller's org. */
function queueWith(name: string, jobs: unknown[] = []) {
  return { name, getJobs: vi.fn().mockResolvedValue(jobs) }
}

function allQueues(jobs: unknown[] = []) {
  return {
    recomputePair: queueWith("recompute-pair", jobs),
    recomputeBatch: queueWith("recompute-batch"),
    import: queueWith("import"),
    sparkline: queueWith("sparkline"),
  }
}

beforeEach(() => {
  getQueuesMock.mockReset()
  isBullMqEnabledMock.mockReset().mockReturnValue(true)
  requireRoleMock.mockReset().mockResolvedValue({ orgId: "org-1", userId: "u1" })
})

describe("GET /api/admin/queue — backend off", () => {
  beforeEach(() => {
    isBullMqEnabledMock.mockReturnValue(false)
  })

  it("answers 200 with an empty list instead of 500", async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ backend: "inprocess", count: 0, jobs: [] })
  })

  it("never opens a Redis connection", async () => {
    await GET(req())
    expect(getQueuesMock).not.toHaveBeenCalled()
  })

  it("still rejects non-admins before answering", async () => {
    requireRoleMock.mockResolvedValue(
      new Response("Forbidden", { status: 403 }),
    )
    const res = await GET(req())
    expect(res.status).toBe(403)
  })
})

describe("GET /api/admin/queue — backend on", () => {
  it("lists jobs from every queue", async () => {
    getQueuesMock.mockReturnValue(
      allQueues([
        {
          id: "job-1",
          data: { organizationId: "org-1" },
          progress: 50,
          attemptsMade: 1,
          failedReason: null,
          timestamp: 10,
          processedOn: 11,
          finishedOn: null,
        },
      ]),
    )
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.backend).toBe("bullmq")
    expect(body.jobs).toHaveLength(1)
    expect(body.jobs[0].jobId).toBe("job-1")
  })

  it("hides another organization's jobs", async () => {
    getQueuesMock.mockReturnValue(
      allQueues([
        {
          id: "job-theirs",
          data: { organizationId: "org-2" },
          progress: 0,
          attemptsMade: 0,
          failedReason: null,
          timestamp: 10,
          processedOn: null,
          finishedOn: null,
        },
      ]),
    )
    const res = await GET(req())
    expect((await res.json()).jobs).toHaveLength(0)
  })

  it("turns a Redis outage into 503 with the reason, not 500", async () => {
    const q = allQueues()
    q.recomputePair.getJobs = vi
      .fn()
      .mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:6379"))
    getQueuesMock.mockReturnValue(q)
    const res = await GET(req())
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.detail).toContain("ECONNREFUSED")
  })

  it("scrubs credentials out of the surfaced reason", async () => {
    const q = allQueues()
    q.recomputePair.getJobs = vi
      .fn()
      .mockRejectedValue(
        new Error("NOAUTH failed for redis://admin:s3cr3t@cache:6379"),
      )
    getQueuesMock.mockReturnValue(q)
    const body = await (await GET(req())).json()
    expect(body.detail).not.toContain("s3cr3t")
    expect(body.detail).toContain("//***@cache:6379")
  })

  it("rejects an unknown state before reaching the queues", async () => {
    const res = await GET(req("bogus"))
    expect(res.status).toBe(400)
    expect(getQueuesMock).not.toHaveBeenCalled()
  })
})
