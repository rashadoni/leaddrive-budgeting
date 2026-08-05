/**
 * 2026-08-04 — the purge endpoint that replaced the worker that never ran.
 *
 * This route hard-deletes financial rows and its only boundary is a Bearer
 * secret, so the cases that matter are the ones about not running: no secret
 * configured, wrong secret, near-miss secret. The happy path is one line by
 * comparison — `runPurge` is tested where it lives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

const runPurgeMock = vi.fn()

vi.mock("@/lib/cleanup/purge-run", () => ({ runPurge: runPurgeMock }))
vi.mock("@/lib/db/prisma-admin", () => ({ prismaAdmin: {} }))

const { GET } = await import("./route")

const SECRET = "s".repeat(40)

function req(authorization?: string) {
  return new NextRequest("http://localhost/api/cron/cleanup-soft-deleted", {
    headers: authorization ? { authorization } : {},
  })
}

const ORIGINAL_SECRET = process.env.CRON_SECRET

beforeEach(() => {
  process.env.CRON_SECRET = SECRET
  runPurgeMock.mockReset().mockResolvedValue({
    counts: {
      budgetPlans: 2,
      cashFlowEntries: 0,
      balanceSheetLines: 1,
      counterparties: 0,
      total: 3,
    },
    durationMs: 41,
    cutoffDays: 30,
    auditEventId: "evt_1",
  })
})

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL_SECRET
})

describe("GET /api/cron/cleanup-soft-deleted — the boundary", () => {
  it("refuses to run at all when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(503)
    // The whole point: an unauthenticated hard-delete endpoint must not exist
    // even for one request while someone forgets to configure the secret.
    expect(runPurgeMock).not.toHaveBeenCalled()
  })

  it("rejects a missing Authorization header", async () => {
    expect((await GET(req())).status).toBe(401)
    expect(runPurgeMock).not.toHaveBeenCalled()
  })

  it("rejects a wrong secret", async () => {
    expect((await GET(req(`Bearer ${"x".repeat(40)}`))).status).toBe(401)
    expect(runPurgeMock).not.toHaveBeenCalled()
  })

  it("rejects a correct-prefix secret that is one byte short", async () => {
    expect((await GET(req(`Bearer ${SECRET.slice(0, -1)}`))).status).toBe(401)
    expect(runPurgeMock).not.toHaveBeenCalled()
  })
})

describe("GET /api/cron/cleanup-soft-deleted — running", () => {
  it("purges and reports what went", async () => {
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.counts.total).toBe(3)
    expect(body.cutoffDays).toBe(30)
    expect(runPurgeMock).toHaveBeenCalledTimes(1)
  })

  it("surfaces a purge that ran without recording its audit event", async () => {
    // The monitor reads that event as the heartbeat, so this case looks like
    // "never ran" on the page. The response says otherwise, in the timer's log.
    runPurgeMock.mockResolvedValue({
      counts: { total: 0 },
      durationMs: 12,
      cutoffDays: 30,
      auditEventId: null,
    })
    const body = await (await GET(req(`Bearer ${SECRET}`))).json()
    expect(body.ok).toBe(true)
    expect(body.auditEventId).toBeNull()
  })

  it("answers 500 when the purge itself fails", async () => {
    runPurgeMock.mockRejectedValue(new Error("deadlock detected"))
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(500)
    expect((await res.json()).reason).toContain("deadlock")
  })
})
