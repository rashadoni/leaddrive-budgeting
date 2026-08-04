/**
 * 2026-08-04 — the background-work inventory endpoint.
 *
 * Two things here are worth a test rather than a glance. The org settings
 * blob is untyped JSON written by three different cron routes, so the
 * reader has to survive a missing key, a non-string value and an
 * unparseable date without inventing a last-run time — a monitor that
 * renders "Invalid Date" as a heartbeat is worse than one that says never.
 * And the endpoint must stay admin-only: its rows carry import verdicts and
 * feed-refresh error counts, which name companies and sources.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const requireRoleMock = vi.fn()
const withOrgScopeMock = vi.fn()
const getQueueBackendMock = vi.fn()

vi.mock("@/lib/api-auth", () => ({
  requireRole: requireRoleMock,
  isAuthError: (v: unknown) => v instanceof Response,
}))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: withOrgScopeMock,
}))
vi.mock("@/lib/queue/feature-flag", () => ({
  getQueueBackend: getQueueBackendMock,
}))

const { GET } = await import("./route")

const req = () => new NextRequest("http://localhost/api/admin/background-jobs")

/** The shape `withOrgScope` resolves to inside the route. */
function scoped(over: Record<string, unknown> = {}) {
  return {
    lastIv: { computedAt: new Date("2026-08-04T13:47:00.000Z") },
    recomputedLast24h: 252,
    lastReport: {
      createdAt: new Date("2026-08-03T17:27:00.000Z"),
      verdict: "green",
    },
    org: { settings: {} },
    lastPurge: null,
    ...over,
  }
}

interface JobRow {
  key: string
  status: string
  lastRunAt: string | null
  detail: Array<{ key: string; value: string }>
}

const job = (body: { jobs: JobRow[] }, key: string): JobRow => {
  const found = body.jobs.find((j) => j.key === key)
  if (!found) throw new Error(`no job ${key} in response`)
  return found
}

beforeEach(() => {
  requireRoleMock.mockReset().mockResolvedValue({ orgId: "org-1", userId: "u1" })
  getQueueBackendMock.mockReset().mockReturnValue("inprocess")
  withOrgScopeMock.mockReset().mockResolvedValue(scoped())
})

describe("GET /api/admin/background-jobs", () => {
  it("returns the inventory with the backend and a worst-case verdict", async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.backend).toBe("inprocess")
    expect(body.overall).toBe("noRunner")
    expect(body.jobs.map((j: { key: string }) => j.key)).toEqual([
      "recompute",
      "import",
      "intelCrawl",
      "feedRefresh",
      "tradeDigest",
      "softDeletePurge",
    ])
  })

  it("scopes every read to the caller's organization", async () => {
    await GET(req())
    expect(withOrgScopeMock).toHaveBeenCalledWith("org-1", expect.any(Function))
  })

  it("rejects a non-admin", async () => {
    requireRoleMock.mockResolvedValue(new Response("Forbidden", { status: 403 }))
    expect((await GET(req())).status).toBe(403)
  })

  it("reads the cron heartbeats out of the settings blob", async () => {
    withOrgScopeMock.mockResolvedValue(
      scoped({
        org: {
          settings: {
            intelLastRunAt: "2026-08-04T07:00:00.000Z",
            feedRefreshLastRunAt: "2026-08-04T07:05:00.000Z",
            feedRefreshLastRunStatus: "ok",
            feedRefreshLastRunErrorCount: 2,
          },
        },
      }),
    )
    const body = await (await GET(req())).json()
    expect(job(body, "intelCrawl").lastRunAt).toBe("2026-08-04T07:00:00.000Z")
    expect(job(body, "feedRefresh").detail).toEqual([
      { key: "runStatus", value: "ok" },
      { key: "errors", value: "2" },
    ])
  })

  it("treats an unparseable or wrongly-typed heartbeat as absent", async () => {
    withOrgScopeMock.mockResolvedValue(
      scoped({
        org: {
          settings: {
            intelLastRunAt: "not-a-date",
            feedRefreshLastRunAt: 1754300000,
            feedRefreshLastRunErrorCount: "two",
          },
        },
      }),
    )
    const body = await (await GET(req())).json()
    expect(job(body, "intelCrawl").lastRunAt).toBeNull()
    expect(job(body, "intelCrawl").status).toBe("never")
    expect(job(body, "feedRefresh").lastRunAt).toBeNull()
    // A non-numeric error count is dropped rather than stringified.
    expect(job(body, "feedRefresh").detail).toEqual([])
  })

  it("survives an organization row with no settings at all", async () => {
    withOrgScopeMock.mockResolvedValue(scoped({ org: null }))
    const body = await (await GET(req())).json()
    expect(job(body, "intelCrawl").status).toBe("never")
  })

  it("answers 503 rather than 500 when the read fails", async () => {
    withOrgScopeMock.mockRejectedValue(new Error("connection terminated"))
    const res = await GET(req())
    expect(res.status).toBe(503)
  })
})
