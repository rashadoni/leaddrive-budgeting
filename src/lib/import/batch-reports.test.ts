/**
 * Phase 11.34 — query/shaping helpers for the ImportBatchReport reader.
 */
import { describe, it, expect } from "vitest"
import {
  parseBatchReportQuery,
  parseBatchReportCursor,
  buildBatchReportWhere,
  shapeBatchReport,
  nextBatchReportCursor,
  BatchReportQueryError,
  BATCH_REPORT_DEFAULT_LIMIT,
  BATCH_REPORT_MAX_LIMIT,
  type BatchReportRow,
} from "./batch-reports"

const q = (s: string) => parseBatchReportQuery(new URLSearchParams(s))

function row(over: Partial<BatchReportRow> = {}): BatchReportRow {
  return {
    id: "r1",
    runId: "run-1",
    fileType: "main-financial",
    filenames: ["Reporting 2026.xlsx"],
    year: 2026,
    verdict: "green",
    evidence: "db-readback",
    sheetsVerified: 8,
    sheetsUnverified: 1,
    rowsInserted: 1200,
    committed: true,
    actorUserId: "u1",
    createdAt: new Date("2026-07-29T10:00:00.000Z"),
    report: { sheets: [{ name: "BS", drift: 0 }] },
    ...over,
  }
}

describe("parseBatchReportQuery", () => {
  it("defaults to a bounded page and no filters", () => {
    expect(q("")).toEqual({ committedOnly: false, limit: BATCH_REPORT_DEFAULT_LIMIT })
  })

  it("caps limit at the maximum instead of trusting the client", () => {
    expect(q("limit=100000").limit).toBe(BATCH_REPORT_MAX_LIMIT)
  })

  it("REJECTS an unknown verdict rather than ignoring the filter", () => {
    // A dropped filter returns the full list, and a reviewer scanning for red
    // imports would read "no red imports" off a filter that never applied.
    expect(() => q("verdict=RED")).toThrow(BatchReportQueryError)
    expect(() => q("verdict=amber")).toThrow(/green \| yellow \| red/)
  })

  it("REJECTS an unknown evidence value", () => {
    expect(() => q("evidence=trust-me")).toThrow(/db-readback \| parse-self-check/)
  })

  it("rejects an implausible year", () => {
    expect(() => q("year=26")).toThrow(BatchReportQueryError)
    expect(q("year=2026").year).toBe(2026)
  })

  it("rejects a non-positive limit", () => {
    expect(() => q("limit=0")).toThrow(BatchReportQueryError)
    expect(() => q("limit=-5")).toThrow(BatchReportQueryError)
  })

  it("reads the committed flag and the accepted filters", () => {
    expect(q("committed=true&verdict=red&evidence=parse-self-check&runId=abc")).toMatchObject({
      committedOnly: true,
      verdict: "red",
      evidence: "parse-self-check",
      runId: "abc",
    })
  })
})

describe("parseBatchReportCursor", () => {
  it("splits timestamp and id", () => {
    const c = parseBatchReportCursor("2026-07-29T10:00:00.000Z|r9")
    expect(c.id).toBe("r9")
    expect(c.createdAt.toISOString()).toBe("2026-07-29T10:00:00.000Z")
  })

  it("rejects a malformed cursor instead of silently paging from the top", () => {
    expect(() => parseBatchReportCursor("nonsense")).toThrow(BatchReportQueryError)
    expect(() => parseBatchReportCursor("not-a-date|r9")).toThrow(BatchReportQueryError)
    expect(() => parseBatchReportCursor("|r9")).toThrow(BatchReportQueryError)
  })
})

describe("buildBatchReportWhere", () => {
  it("always scopes to the organization", () => {
    expect(buildBatchReportWhere("org1", q("")).organizationId).toBe("org1")
  })

  it("uses a COMPOSITE cursor so same-millisecond rows are not dropped", () => {
    // One bulk import writes a row per file-group inside a single
    // transaction, so several rows share an exact ms. A strict `lt` on
    // createdAt would lose whole file-groups of a run at the page boundary.
    const where = buildBatchReportWhere("org1", q("cursor=2026-07-29T10:00:00.000Z|r5"))
    expect(where.OR).toEqual([
      { createdAt: { lt: new Date("2026-07-29T10:00:00.000Z") } },
      { createdAt: new Date("2026-07-29T10:00:00.000Z"), id: { lt: "r5" } },
    ])
  })

  it("omits absent filters entirely", () => {
    const where = buildBatchReportWhere("org1", q(""))
    expect(where).toEqual({ organizationId: "org1" })
  })
})

describe("shapeBatchReport", () => {
  it("flags a verdict that rests on a parse-time self-check", () => {
    // The whole point of the `evidence` column: a green backed by
    // parse-self-check proves nothing about what landed in the database.
    expect(shapeBatchReport(row({ evidence: "parse-self-check" }), false).verdictUnverified).toBe(
      true,
    )
    expect(shapeBatchReport(row(), false).verdictUnverified).toBe(false)
  })

  it("omits the heavy report JSON unless asked", () => {
    expect(shapeBatchReport(row(), false).report).toBeUndefined()
    expect(shapeBatchReport(row(), true).report).toEqual({ sheets: [{ name: "BS", drift: 0 }] })
  })
})

describe("nextBatchReportCursor", () => {
  it("is null on the last page", () => {
    expect(nextBatchReportCursor([row()], false)).toBeNull()
    expect(nextBatchReportCursor([], true)).toBeNull()
  })

  it("points at the last row of the page", () => {
    const rows = [row({ id: "a" }), row({ id: "b" })]
    expect(nextBatchReportCursor(rows, true)).toBe("2026-07-29T10:00:00.000Z|b")
  })
})
