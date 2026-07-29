/**
 * Phase 11.21 — a BS re-import cleans what THAT SHEET wrote.
 *
 * The dispatcher used to build its delete window from the months present in
 * the NEW file, so a corrected re-import covering fewer months left the
 * dropped ones holding the previous import's balances — silently, until 11.21
 * made it at least report the residue. Widening the window to the whole year
 * was never an option: two BS sheets covering different months of one year
 * would delete each other's rows.
 *
 * `BalanceSheetLine.sourceDocument` is what makes both possible at once. These
 * tests pin the delete SHAPE, because that is the part that decides whether a
 * re-import corrects the year or corrupts it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// `vi.mock` factories are hoisted above these declarations, so the mocks live
// on a hoisted holder rather than in module scope.
const m = vi.hoisted(() => ({
  deleteMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
  createMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
  findMany: vi.fn(async () => [] as Array<{ month: number }>),
}))
const { deleteMany, createMany, findMany } = m

vi.mock("@/lib/prisma", () => {
  const tx = {
    balanceSheetLine: {
      deleteMany: m.deleteMany,
      createMany: m.createMany,
      findMany: m.findMany,
    },
    chartOfAccount: {
      findUnique: vi.fn(async () => ({ id: "coa1" })),
      create: vi.fn(async () => ({ id: "coa1" })),
    },
  }
  return {
    prisma: {
      company: {
        findFirst: vi.fn(async () => ({ id: "comp1", baseCurrencyCode: "AZN" })),
      },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    },
  }
})
vi.mock("@/lib/onboarding/resolve-plan", () => ({
  resolveImportPlan: vi.fn(async () => ({ id: "plan1" })),
}))
vi.mock("@/lib/onboarding/azseker-workbook-mapping", () => ({
  classifyWorkbookSheetFamily: vi.fn(() => "BS"),
  resolveEntityFromSheetName: vi.fn(() => "AZSEKER-AZSF"),
}))
vi.mock("@/lib/onboarding/adapters/azseker-workbook-bs", () => ({
  parseWorkbookBsSheet: vi.fn(() => ({
    lines: [
      {
        code: "BS.01.01",
        label: "Cash",
        lineType: "asset",
        subType: "current",
        // Only Jan and Feb — the "corrected re-import covers fewer months" case.
        monthlyAmounts: { "2026-1": 100, "2026-2": 200 },
      },
    ],
    warnings: [],
  })),
}))

import { runBsDispatcher } from "./apply-multi-dispatchers"

const WORKBOOK = { SheetNames: ["BS AZSF"], Sheets: {} } as never

async function run() {
  return runBsDispatcher({
    workbook: WORKBOOK,
    XLSX: {} as never,
    targetYear: 2026,
    orgIdLocal: "org1",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue([])
})

describe("BS re-import delete window", () => {
  it("deletes THIS sheet's rows across the whole year, not just the months it still covers", async () => {
    await run()
    const where = (deleteMany.mock.calls[0][0] as unknown as { where: Record<string, unknown> })
      .where
    expect(where).toMatchObject({ planId: "plan1", companyId: "comp1", year: 2026 })
    // No top-level month filter: a month this re-import dropped must still be
    // cleaned, which is the whole defect.
    expect(where).not.toHaveProperty("month")
    expect(where.OR).toContainEqual({ sourceDocument: "apply-multi:BS AZSF" })
  })

  it("still bounds UNTAGGED legacy rows by the month window", async () => {
    // Rows written before the column existed carry null. Deleting those across
    // the year would wipe a sibling sheet's months; leaving them out entirely
    // would double-count on the first re-import after the migration.
    await run()
    const where = (deleteMany.mock.calls[0][0] as unknown as { where: { OR: unknown[] } }).where
    expect(where.OR).toContainEqual({
      sourceDocument: null,
      month: { in: [1, 2] },
    })
  })

  it("tags every inserted row with the sheet it came from", async () => {
    await run()
    const data = (createMany.mock.calls[0][0] as unknown as {
      data: Array<{ sourceDocument: string }>
    }).data
    expect(data).toHaveLength(2)
    expect(data.every((r) => r.sourceDocument === "apply-multi:BS AZSF")).toBe(true)
  })

  it("reports a residue month as belonging to ANOTHER source, not to this re-import", async () => {
    findMany.mockResolvedValue([{ month: 7 }])
    const { bsResults } = await run()
    expect(bsResults[0].staleMonths).toMatch(/months 7 /)
    expect(bsResults[0].staleMonths).toMatch(/ANOTHER source/)
  })

  it("says nothing when no other source holds the year", async () => {
    const { bsResults } = await run()
    expect(bsResults[0].staleMonths).toBeUndefined()
  })
})
