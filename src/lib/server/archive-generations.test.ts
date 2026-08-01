// @vitest-environment node
/**
 * The production shape, reproduced.
 *
 * `budget_lines` on the live database held 33,923 rows of which only 2,979 were
 * live: every re-import archives the generation it replaces and deliberately
 * leaves it there (`import-batch.ts`, `purgeArchivedFirst` off — "pileup is
 * harmless to reads"). One company-year therefore accumulates several archived
 * GENERATIONS in the same plan, e.g. measured for 2026 budget:
 *
 *     archived 2026-07-31 13:37 → 2045 rows
 *     archived 2026-07-29 21:40 → 1234 rows
 *     archived 2026-07-29 21:39 →  811 rows
 *
 * `restoreRows` used to un-archive by scope alone (`deletedAt: { not: null }`),
 * so "bring it back" on any one of those made all three live at once and
 * multiplied the profit & loss. These tests hold rows in memory rather than
 * asserting on a WHERE object, because the defect was not in the shape of the
 * filter — it was in how many generations the filter reached.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

const { logAuditEventMock } = vi.hoisted(() => ({ logAuditEventMock: vi.fn() }))
vi.mock("@/lib/audit/log", () => ({ logAuditEvent: logAuditEventMock }))

import { archiveRows, restoreRows } from "./archive"

const ORG = "org1"
const COMPANY_ID = "c1"
const YEAR = 2026

interface Row {
  id: number
  organizationId: string
  companyId: string
  planYear: number
  deletedAt: Date | null
  deletedBy: string | null
}

let rows: Row[]
let nextId: number

/** The subset of Prisma WHERE semantics these two functions actually build. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "plan") {
      if ((cond as { year: number }).year !== row.planYear) return false
      continue
    }
    const value = (row as unknown as Record<string, unknown>)[key]
    if (cond === null) {
      if (value !== null) return false
    } else if (cond instanceof Date) {
      // Exact instant — the whole point of the key.
      if (!(value instanceof Date) || value.getTime() !== cond.getTime()) return false
    } else if (cond && typeof cond === "object" && "not" in (cond as object)) {
      const not = (cond as { not: unknown }).not
      if (not === null) {
        if (value === null) return false
      } else if (value === not) {
        return false
      }
    } else if (value !== cond) {
      return false
    }
  }
  return true
}

const budgetLine = {
  updateMany: vi.fn(
    async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      let count = 0
      for (const row of rows) {
        if (!matches(row, where)) continue
        Object.assign(row, data)
        count++
      }
      return { count }
    },
  ),
}

const prismaMock = {
  company: { findFirst: vi.fn(async () => ({ id: COMPANY_ID })) },
  budgetLine,
  balanceSheetLine: { updateMany: vi.fn(async () => ({ count: 0 })) },
  cashFlowEntry: { updateMany: vi.fn(async () => ({ count: 0 })) },
  counterparty: { updateMany: vi.fn(async () => ({ count: 0 })) },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
}

function addLiveRows(n: number) {
  for (let i = 0; i < n; i++) {
    rows.push({
      id: nextId++,
      organizationId: ORG,
      companyId: COMPANY_ID,
      planYear: YEAR,
      deletedAt: null,
      deletedBy: null,
    })
  }
}

const scope = {
  organizationId: ORG,
  entityKind: "BudgetLine" as const,
  companyCode: "AZSEKER-AZSF",
  year: YEAR,
}

/**
 * Import n rows, then archive them — one generation, exactly as a re-import
 * leaves it. Returns the key the audit event recorded for that generation.
 */
async function archiveGeneration(n: number): Promise<string> {
  addLiveRows(n)
  const result = await archiveRows({
    prisma: prismaMock as never,
    actorUserId: "u1",
    scope,
  })
  expect(result.rowsAffected).toBe(n)
  expect(result.archivedAt).toBeTruthy()
  return result.archivedAt as string
}

const liveCount = () => rows.filter((r) => r.deletedAt === null).length
const archivedAtCount = (iso: string) =>
  rows.filter((r) => r.deletedAt !== null && r.deletedAt.toISOString() === iso).length

beforeEach(() => {
  vi.clearAllMocks()
  rows = []
  nextId = 1
  prismaMock.company.findFirst.mockResolvedValue({ id: COMPANY_ID })
  logAuditEventMock.mockResolvedValue({ ok: true, id: "a1" })
  // Two consecutive `new Date()` calls can land in the same millisecond in a
  // unit test, which never happens between two real archive transactions.
  // Advancing fake time gives each generation the distinct stamp production
  // gives it, without a sleep.
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-29T21:39:00.000Z"))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("three generations of one company-year", () => {
  it("restores the middle one and leaves the other two archived", async () => {
    // 811 rows, then 1234, then 2045 — the measured production pile-up,
    // scaled-down counts, same structure: same org, same company, same plan
    // year, three different archive timestamps.
    const first = await archiveGeneration(811)
    vi.advanceTimersByTime(60_000)
    const middle = await archiveGeneration(1234)
    vi.advanceTimersByTime(60_000)
    const last = await archiveGeneration(2045)

    expect(new Set([first, middle, last]).size).toBe(3)
    expect(liveCount()).toBe(0)
    expect(rows).toHaveLength(811 + 1234 + 2045)

    const result = await restoreRows({
      prisma: prismaMock as never,
      actorUserId: "u1",
      scope,
      archivedAt: new Date(middle),
    })

    // Exactly the middle generation, and nothing else.
    expect(result.rowsAffected).toBe(1234)
    expect(liveCount()).toBe(1234)
    expect(archivedAtCount(first)).toBe(811)
    expect(archivedAtCount(middle)).toBe(0)
    expect(archivedAtCount(last)).toBe(2045)
  })

  it("the pre-fix filter would have made all 4090 live — 3.3× what was asked for", async () => {
    await archiveGeneration(811)
    vi.advanceTimersByTime(60_000)
    const middle = await archiveGeneration(1234)
    vi.advanceTimersByTime(60_000)
    await archiveGeneration(2045)

    // Exactly what `restoreRows` used to build, run against the same rows.
    // Kept as a live comparison rather than a comment: it is the number the
    // operator would have seen in "brought back N rows", and the multiplier
    // that would have landed in the profit & loss.
    const preFix = await budgetLine.updateMany({
      where: {
        organizationId: ORG,
        companyId: COMPANY_ID,
        plan: { year: YEAR },
        deletedAt: { not: null },
      },
      data: { deletedAt: null, deletedBy: null },
    })
    expect(preFix.count).toBe(4090)
    // The generation the operator picked held 1234 of those.
    expect(preFix.count).toBeGreaterThan(1234)
    expect(new Date(middle).getTime()).toBeGreaterThan(0)
  })

  it("restoring the same generation twice is a no-op the second time", async () => {
    const only = await archiveGeneration(500)
    const first = await restoreRows({
      prisma: prismaMock as never,
      actorUserId: "u1",
      scope,
      archivedAt: new Date(only),
    })
    const second = await restoreRows({
      prisma: prismaMock as never,
      actorUserId: "u1",
      scope,
      archivedAt: new Date(only),
    })
    expect(first.rowsAffected).toBe(500)
    expect(second.rowsAffected).toBe(0)
    expect(liveCount()).toBe(500)
  })

  it("a key from a DIFFERENT operation restores nothing, rather than everything", async () => {
    await archiveGeneration(811)
    const unrelated = new Date("2020-01-01T00:00:00.000Z")
    const result = await restoreRows({
      prisma: prismaMock as never,
      actorUserId: "u1",
      scope,
      archivedAt: unrelated,
    })
    expect(result.rowsAffected).toBe(0)
    expect(liveCount()).toBe(0)
  })

  it("the key survives the ISO round trip to the millisecond", async () => {
    vi.setSystemTime(new Date("2026-07-31T13:37:00.123Z"))
    const key = await archiveGeneration(10)
    expect(key).toBe("2026-07-31T13:37:00.123Z")
    const result = await restoreRows({
      prisma: prismaMock as never,
      actorUserId: "u1",
      scope,
      archivedAt: new Date(key),
    })
    expect(result.rowsAffected).toBe(10)
  })
})
