// @vitest-environment node
/**
 * Handler test for `/api/recompute/jobs/[jobId]` (GET).
 *
 * Phase 6.1 — recompute job status endpoint. Locks:
 * - 404 on cross-tenant jobId (never leak existence)
 * - progressPct math: round((processed/total)*100), 0 when total=0
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

const { getJobMock } = vi.hoisted(() => ({ getJobMock: vi.fn() }))
vi.mock("@/lib/recompute/job-runner", () => ({ getJob: getJobMock }))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  getJobMock.mockReset().mockReturnValue(null)
})

describe("GET /api/recompute/jobs/[jobId]", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(
      makeRequest("/api/recompute/jobs/job-1"),
      { params: Promise.resolve({ jobId: "job-1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("400 invalid jobId (whitespace-only)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(
      makeRequest("/api/recompute/jobs/blank"),
      { params: Promise.resolve({ jobId: "  " }) },
    )
    expect(res.status).toBe(400)
  })

  it("404 cross-tenant jobId (getJob returns null)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    getJobMock.mockReturnValue(null)
    const res = await GET(
      makeRequest("/api/recompute/jobs/other-job"),
      { params: Promise.resolve({ jobId: "other-job" }) },
    )
    expect(res.status).toBe(404)
    // getJob was called with the org scope (existence not leaked)
    expect(getJobMock).toHaveBeenCalledWith("other-job", ORG_ID)
  })

  it("200 returns full job status + progressPct rounded", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    getJobMock.mockReturnValue({
      jobId: "job-1",
      status: "running",
      total: 100,
      processed: 33,
      ok: 30,
      unknown: 0,
      errored: 3,
      createdAt: new Date("2026-05-17T10:00:00Z"),
      startedAt: new Date("2026-05-17T10:00:01Z"),
      finishedAt: null,
      errorMessage: null,
      recentResults: [],
    })
    const res = await GET(
      makeRequest("/api/recompute/jobs/job-1"),
      { params: Promise.resolve({ jobId: "job-1" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.status).toBe("running")
    expect(body.processed).toBe(33)
    expect(body.progressPct).toBe(33) // round(33/100 * 100)
  })

  it("progressPct = 0 when total is 0 (avoids divide-by-zero NaN)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    getJobMock.mockReturnValue({
      jobId: "empty-job",
      status: "queued",
      total: 0,
      processed: 0,
      ok: 0,
      unknown: 0,
      errored: 0,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
      recentResults: [],
    })
    const res = await GET(
      makeRequest("/api/recompute/jobs/empty-job"),
      { params: Promise.resolve({ jobId: "empty-job" }) },
    )
    const body = await res.json()
    expect(body.progressPct).toBe(0)
  })
})
