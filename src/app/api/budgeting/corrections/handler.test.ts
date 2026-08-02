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
/** What the target cell already holds, for the `setTo` tests. */
let currentCellTotal = 0
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
        // 14.3 — what the cell currently holds, so "set it to X" can resolve
        // into the adjustment that gets there.
        aggregate: async () => ({ _sum: { plannedAmount: currentCellTotal } }),
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
  currentCellTotal = 0
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
    // ZERO-BASED, and the period is 1-based: "2026-04" is April, monthIndex 3.
    // The importer writes `monthIndex: m` from a 0..11 loop and every reader
    // does `monthIndex + 1`. This route shipped with the 1-based number and
    // would have dated every correction a month late.
    expect(row.monthIndex).toBe(3)
    expect(row.plannedAmount).toBe(-40_000)
  })

  it("dates every month of the year correctly, not just April", async () => {
    // One assertion on one month would have passed with the off-by-one for
    // three months of the year by coincidence. December is the one that
    // matters most: 1-based 12 is out of range for a zero-based index and
    // would have bucketed nowhere at all.
    for (const [period, expected] of [
      ["2026-01", 0],
      ["2026-04", 3],
      ["2026-12", 11],
    ] as const) {
      created.length = 0
      const res = await post({ ...good, period })
      expect(res.status, period).toBe(200)
      expect(created[0].monthIndex, period).toBe(expected)
    }
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

  it("turns \"this should be 80,000\" into the adjustment that gets there", async () => {
    // The owner asked to edit existing figures. This is the outcome without
    // the mechanism: they say what the number should be, the system writes the
    // difference, attributed, and the imported row stays untouched.
    currentCellTotal = 77_800
    const res = await post({ ...good, amount: undefined, setTo: 80_000 })
    expect(res.status).toBe(200)
    expect(created[0].plannedAmount).toBeCloseTo(2_200, 6)
    expect(created[0].origin).toBe("manual_correction")
    const body = await res.json()
    expect(body.setTo).toMatchObject({ from: 77_800, to: 80_000 })
  })

  it("computes the delta against what the reader SEES, corrections included", async () => {
    // The cell total already contains any earlier adjustment. Computing
    // against the imported rows alone would silently double whatever was
    // corrected before.
    currentCellTotal = 80_000 // 77,800 imported + a 2,200 correction
    await post({ ...good, amount: undefined, setTo: 85_000 })
    expect(created[0].plannedAmount).toBeCloseTo(5_000, 6)
  })

  it("goes down as readily as up", async () => {
    currentCellTotal = 100
    await post({ ...good, amount: undefined, setTo: 40 })
    expect(created[0].plannedAmount).toBeCloseTo(-60, 6)
  })

  it("refuses when the cell already holds that figure", async () => {
    // A correction that changes nothing would still sit in every total and
    // every review queue, being nothing.
    currentCellTotal = 80_000
    const res = await post({ ...good, amount: undefined, setTo: 80_000 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("already_equals")
    expect(created).toHaveLength(0)
  })

  it("refuses both an amount and a target at once, and neither", async () => {
    // Two answers to "how much" is a bug waiting for a reader to pick the
    // wrong one.
    expect((await post({ ...good, setTo: 80_000 })).status).toBe(400)
    expect((await post({ ...good, amount: undefined })).status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it("still demands a reason when setting a target", async () => {
    currentCellTotal = 1
    const res = await post({ ...good, amount: undefined, setTo: 999, reason: "" })
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it("requires a session", async () => {
    getSessionMock.mockResolvedValue(null)
    expect((await post(good)).status).toBe(401)
  })
})
