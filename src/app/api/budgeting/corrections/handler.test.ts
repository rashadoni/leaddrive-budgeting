/**
 * Phase 13.6 — the write path for a manual correction.
 *
 * The assertions worth having here are the REFUSALS and the SHAPE of what gets
 * written, not the happy path. A correction that lands without `origin` is
 * indistinguishable from an imported row, which means the next import archives
 * it — the exact failure the whole feature exists to avoid, and one that would
 * only show up on someone's second import, weeks later.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const created: Array<Record<string, unknown>> = []
const audited: Array<Record<string, unknown>> = []
const getSessionMock = vi.fn()
const activeLock = vi.fn()

vi.mock("@/lib/api-auth", () => ({ getSession: getSessionMock }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/budgeting/period-lock", () => ({
  getActivePeriodLock: (...a: unknown[]) => activeLock(...a),
  derivePeriodKey: () => "2026-04",
}))
vi.mock("@/lib/budgeting/period-lock-http", () => ({
  lockedResponse: () => new Response("locked", { status: 423 }),
}))
vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: async (_tx: unknown, args: Record<string, unknown>) => {
    audited.push(args)
    return { ok: true, id: "audit-1" }
  },
}))
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_org: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      chartOfAccount: {
        findFirst: async ({ where }: { where: { id: string } }) =>
          where.id === "acct-ok" ? { id: "acct-ok", code: "PLF.09.01" } : null,
      },
      budgetPlan: {
        findFirst: async ({ where }: { where: { id: string } }) =>
          where.id === "plan-ok" ? { id: "plan-ok", year: 2026 } : null,
      },
      budgetLine: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data)
          return { id: "line-1", plannedAmount: data.plannedAmount, correctionAt: new Date() }
        },
        findMany: async () => [],
      },
    }),
}))

const { POST } = await import("./route")

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/budgeting/corrections", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  )
}

const good = {
  companyId: "co-eden",
  planId: "plan-ok",
  accountId: "acct-ok",
  period: "2026-04",
  amount: -40_000,
  lineType: "expense",
  reason: "PLF.09.01 shareholders' expense is missing from the 2026 sheet",
}

beforeEach(() => {
  created.length = 0
  audited.length = 0
  getSessionMock.mockReset().mockResolvedValue({ orgId: "org-1", userId: "u-rashad" })
  activeLock.mockReset().mockResolvedValue(null)
})

describe("POST /api/budgeting/corrections", () => {
  it("writes a row that is unmistakably a correction", async () => {
    const res = await post(good)
    expect(res.status).toBe(200)
    const row = created[0]
    // `origin` is the field the import's clean-slate keys on. Without it the
    // next import silently archives this row and the number reverts.
    expect(row.origin).toBe("manual_correction")
    expect(row.correctionBy).toBe("u-rashad")
    expect(row.correctionReason).toContain("PLF.09.01")
    expect(row.correctionAt).toBeInstanceOf(Date)
    // Nothing to review on the day it is created — no import has run since.
    expect(row.correctionReviewAt).toBeNull()
    // And it names itself in the one field every export already prints.
    expect(String(row.sourceDocument)).toContain("manual-correction")
    expect(row.monthIndex).toBe(4)
    expect(row.plannedAmount).toBe(-40_000)
  })

  it("records the mutation in the audit log as well as on the row", async () => {
    // The row records the CLAIM; the log records the MUTATION. Only the log
    // survives the row being archived or superseded.
    await post(good)
    expect(audited).toHaveLength(1)
    const ev = audited[0].event as { action: string; metadata: Record<string, unknown> }
    expect(ev.action).toBe("budget_correction_create")
    expect(ev.metadata.accountCode).toBe("PLF.09.01")
    expect(ev.metadata.amount).toBe(-40_000)
  })

  it("refuses a correction with no reason, and says why in a sentence", async () => {
    const res = await post({ ...good, reason: "" })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("empty_reason")
    expect(body.message).toMatch(/distinguishes it from a mistake/)
    expect(created).toHaveLength(0)
  })

  it("refuses a zero adjustment", async () => {
    expect((await post({ ...good, amount: 0 })).status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it("refuses a year or quarter period — corrections are monthly", async () => {
    for (const period of ["2026", "2026-Q2"]) {
      expect((await post({ ...good, period })).status, period).toBe(400)
    }
    expect(created).toHaveLength(0)
  })

  it("respects a period lock rather than offering a side door", async () => {
    // "The period is closed" and "the number is wrong" are both true at once,
    // and the resolution is a conversation with whoever locked it.
    activeLock.mockResolvedValue({ id: "lock-1", periodKey: "2026-04" })
    expect((await post(good)).status).toBe(423)
    expect(created).toHaveLength(0)
  })

  it("404s an account or plan from another organization without saying which", async () => {
    // RLS already scopes the read, so a foreign id returns nothing. Answering
    // 404 rather than a foreign-key error keeps it from confirming the id
    // exists somewhere else.
    expect((await post({ ...good, accountId: "acct-elsewhere" })).status).toBe(404)
    expect((await post({ ...good, planId: "plan-elsewhere" })).status).toBe(404)
    expect(created).toHaveLength(0)
  })

  it("requires a session", async () => {
    getSessionMock.mockResolvedValue(null)
    expect((await post(good)).status).toBe(401)
  })
})
