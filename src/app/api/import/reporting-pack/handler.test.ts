/**
 * Route tests for POST /api/import/reporting-pack.
 *
 * Strategy: mock auth / rate-limit / prisma / the importer / recompute so the
 * test exercises ONLY the route's wiring (auth gate, file validation,
 * preview-vs-apply pass-through, recompute fan-out, error sanitisation).
 * The importer + parsers are covered by their own unit tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/api-auth", () => ({
  requireRole: vi.fn(),
  isAuthError: (r: unknown) => r instanceof Response,
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => "1.2.3.4"),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { company: { findMany: vi.fn(async () => [{ id: "c1", code: "AZSEKER-AZSF" }]) } },
}))
vi.mock("@/lib/ai/ai-error", () => ({
  aiErrorBody: () => ({ error: "sanitised" }),
}))
vi.mock("xlsx", () => ({
  read: vi.fn(() => ({ SheetNames: [], Sheets: {} })),
  // decode_range used by the per-sheet cell-count DoS guard. Default range is
  // tiny; the cell-guard test overrides read() to return a big-!ref sheet.
  utils: { decode_range: vi.fn(() => ({ s: { r: 0, c: 0 }, e: { r: 99999, c: 19 } })) },
}))
vi.mock("@/lib/onboarding/adapters/reporting-pack-importer", () => ({
  runReportingPackImport: vi.fn(),
}))
vi.mock("@/lib/risk/recompute-trigger", () => ({
  runRecomputeForCompanies: vi.fn(async () => ({ ok: 1, unknown: 0, failed: 0, targets: 1 })),
}))
// Phase 11.34 — the period-lock gate this route was missing.
vi.mock("@/lib/budgeting/period-lock", () => ({
  getActivePeriodLock: vi.fn(async () => null),
}))
// 11.41 — the apply path now takes a Postgres session advisory lock on its
// own connection. Stub it: these tests assert route wiring, not locking, and
// must never open a real connection.
vi.mock("@/lib/onboarding/import-lock", () => ({
  acquireImportLock: vi.fn(),
}))
vi.mock("@/lib/budgeting/period-lock-http", () => ({
  lockedResponse: vi.fn(
    () => new Response(JSON.stringify({ error: "period locked" }), { status: 423 }),
  ),
}))

import * as XLSX from "xlsx"
import { requireRole } from "@/lib/api-auth"
import { runReportingPackImport } from "@/lib/onboarding/adapters/reporting-pack-importer"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"
import { getActivePeriodLock } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { acquireImportLock } from "@/lib/onboarding/import-lock"
import { POST } from "./route"

/** Shared release spy — `vi.clearAllMocks()` resets its recorded calls. */
const release = vi.fn(async () => undefined)

const SESSION = { userId: "u1", orgId: "org1", role: "admin" as const }

function makeReq(fields: Record<string, string | Blob>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    // Name Blob file fields .xlsx so they pass the extension gate — mirrors
    // how a browser file input sends the real filename.
    if (v instanceof Blob) fd.append(k, v, "Reporting 2026.xlsx")
    else fd.append(k, v)
  }
  return new Request("http://t/api/import/reporting-pack", {
    method: "POST",
    body: fd,
  }) as never
}

const xlsxBlob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" })

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireRole as ReturnType<typeof vi.fn>).mockResolvedValue(SESSION)
  // `clearAllMocks` clears recorded CALLS, not the `…Once` QUEUE. The
  // "still allows a PREVIEW of a locked year" case queues a
  // mockResolvedValueOnce(LOCK) that the preview path never consumes —
  // getActivePeriodLock is not called on a preview — so the stale LOCK leaked
  // forward and 423'd the first APPLY test declared after it. A landmine the
  // 11.41 tests were the first to step on. mockReset drains the queue.
  ;(getActivePeriodLock as ReturnType<typeof vi.fn>).mockReset()
  ;(getActivePeriodLock as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  // Derives the scope from the ARGS, so a route that locked the wrong year
  // cannot pass against a hardcoded string.
  ;(acquireImportLock as ReturnType<typeof vi.fn>).mockImplementation(
    async (orgId: string, year: number) => ({
      acquired: true,
      scope: `ai-import:${orgId}:${year}`,
      release,
    }),
  )
  ;(runReportingPackImport as ReturnType<typeof vi.fn>).mockImplementation(
    async (input: { mode: string }, deps: { onAfterApply?: (c: string[]) => Promise<void> }) => {
      if (input.mode === "apply" && deps.onAfterApply) await deps.onAfterApply(["AZSEKER-AZSF"])
      return {
        mode: input.mode === "apply" ? "applied" : "preview",
        organizationId: "org1",
        year: 2026,
        reports: [],
        totalLineCount: 5,
        totalRowsWritten: input.mode === "apply" ? 5 : 0,
        affectedEntities: input.mode === "apply" ? ["AZSEKER-AZSF"] : [],
        warnings: [],
      }
    },
  )
})

describe("POST /api/import/reporting-pack", () => {
  it("rejects non-admins (auth gate)", async () => {
    ;(requireRole as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 403 }))
    const res = await POST(makeReq({ file: xlsxBlob() }))
    expect(res.status).toBe(403)
    expect(runReportingPackImport).not.toHaveBeenCalled()
  })

  it("400s when no file is supplied", async () => {
    const res = await POST(makeReq({ year: "2026" }))
    expect(res.status).toBe(400)
  })

  it("415s a non-.xlsx file", async () => {
    const fd = new FormData()
    fd.append("file", xlsxBlob(), "report.csv")
    const req = new Request("http://t/api/import/reporting-pack", { method: "POST", body: fd }) as never
    const res = await POST(req)
    expect(res.status).toBe(415)
    expect(runReportingPackImport).not.toHaveBeenCalled()
  })

  it("400s an out-of-range year", async () => {
    const res = await POST(makeReq({ file: xlsxBlob(), year: "99999" }))
    expect(res.status).toBe(400)
    expect(runReportingPackImport).not.toHaveBeenCalled()
  })

  it("413s a sheet that expands past the cell-count DoS guard", async () => {
    // read() returns a sheet whose !ref decodes (via the mocked decode_range)
    // to 100000×20 = 2,000,000 cells > 500k.
    ;(XLSX.read as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      SheetNames: ["Big"],
      Sheets: { Big: { "!ref": "A1:T100000" } },
    })
    const res = await POST(makeReq({ file: xlsxBlob(), year: "2026" }))
    expect(res.status).toBe(413)
    expect(runReportingPackImport).not.toHaveBeenCalled()
  })

  it("runs PREVIEW by default (apply omitted) without recompute", async () => {
    const res = await POST(makeReq({ file: xlsxBlob(), year: "2026" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mode).toBe("preview")
    expect(body.totalRowsWritten).toBe(0)
    const call = (runReportingPackImport as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.mode).toBe("preview")
    expect(call.year).toBe(2026)
    expect(runRecomputeForCompanies).not.toHaveBeenCalled()
  })

  it("APPLIES on apply=1 and fans recompute to the touched companies", async () => {
    const res = await POST(makeReq({ file: xlsxBlob(), year: "2026", apply: "1" }))
    const body = await res.json()
    expect(body.mode).toBe("applied")
    expect(body.totalRowsWritten).toBe(5)
    const call = (runReportingPackImport as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.mode).toBe("apply")
    // entityCode AZSEKER-AZSF → companyId c1, year 2026.
    // 11.40 — the last two arguments are NEW and their absence was the
    // defect: the call took the default `granularity: 'year'` while the reset
    // deletes "YYYY", "YYYY-Qn" and "YYYY-MM" alike, so a reset + re-import
    // rebuilt one period out of seventeen and left every monthly cell empty.
    // Updated deliberately, not deleted: pinning the call SHAPE is right, it
    // was simply pinned two arguments short.
    expect(runRecomputeForCompanies).toHaveBeenCalledWith(
      expect.anything(),
      "org1",
      [{ companyId: "c1", year: 2026 }],
      {},
      { granularity: "year+quarter+month" },
    )
  })

  it("sanitises importer errors as a 500", async () => {
    ;(runReportingPackImport as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("raw DB internals: password=secret"),
    )
    const res = await POST(makeReq({ file: xlsxBlob(), year: "2026", apply: "1" }))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.error).toBe("sanitised")
    expect(JSON.stringify(body)).not.toContain("secret")
  })

  // ── Phase 11.34 — period-lock gate ────────────────────────────────
  // 11.13 gated /api/import/ai-auto-multi and left this route open. Both
  // write the same BudgetLine / CashFlowEntry rows for a year, so a signed,
  // closed period stayed rewritable through whichever door had no gate.
  describe("period lock", () => {
    const LOCK = { period: "2026", lockedBy: "cfo", lockedAt: "2026-07-01", reason: "signed" }

    it("REFUSES an apply into a locked year", async () => {
      ;(getActivePeriodLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(LOCK)
      const res = await POST(makeReq({ file: xlsxBlob(), year: "2026", apply: "1" }))
      expect(res.status).toBe(423)
      expect(runReportingPackImport).not.toHaveBeenCalled()
      expect(lockedResponse).toHaveBeenCalledWith(
        LOCK,
        expect.objectContaining({ route: "POST /api/import/reporting-pack" }),
      )
    })

    it("checks the lock for the YEAR being imported, not the current one", async () => {
      await POST(makeReq({ file: xlsxBlob(), year: "2024", apply: "1" }))
      expect(getActivePeriodLock).toHaveBeenCalledWith(expect.anything(), "org1", "2024")
    })

    it("still allows a PREVIEW of a locked year — a preview writes nothing", async () => {
      ;(getActivePeriodLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(LOCK)
      const res = await POST(makeReq({ file: xlsxBlob(), year: "2026" }))
      expect(res.status).toBe(200)
      expect(runReportingPackImport).toHaveBeenCalled()
    })

    it("does not consult the lock at all on the preview path", async () => {
      await POST(makeReq({ file: xlsxBlob(), year: "2026" }))
      expect(getActivePeriodLock).not.toHaveBeenCalled()
    })
  })

  // ── 11.41 — concurrency lock ─────────────────────────────────────
  // 11.8 gave /api/import/ai-auto-multi a session advisory lock and left this
  // route without one. Both clean-slate the same BudgetLine / CashFlowEntry
  // rows for a year, so two concurrent applies leave a full duplicate set —
  // and cash_flow_entries has no unique constraint to reject the second copy.
  describe("concurrency lock (11.41)", () => {
    it("takes the (org, year) import lock before an apply", async () => {
      const res = await POST(makeReq({ file: xlsxBlob(), year: "2026", apply: "1" }))
      expect(res.status).toBe(200)
      expect(acquireImportLock).toHaveBeenCalledWith("org1", 2026)
    })

    it("locks the YEAR being imported, not the current one", async () => {
      await POST(makeReq({ file: xlsxBlob(), year: "2024", apply: "1" }))
      expect(acquireImportLock).toHaveBeenCalledWith("org1", 2024)
    })

    it("refuses a concurrent apply with 409 IMPORT_IN_PROGRESS", async () => {
      ;(acquireImportLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        acquired: false,
        scope: "ai-import:org1:2026",
        release,
      })
      const res = await POST(makeReq({ file: xlsxBlob(), year: "2026", apply: "1" }))
      const body = await res.json()
      expect(res.status).toBe(409)
      expect(body.code).toBe("IMPORT_IN_PROGRESS")
      expect(runReportingPackImport).not.toHaveBeenCalled()
      // Released even when NOT acquired — release() closes the dedicated pg
      // client, so skipping it leaks a connection per refusal.
      expect(release).toHaveBeenCalledTimes(1)
    })

    it("releases the lock when the import THROWS", async () => {
      // A session lock held by a dead request blocks every later import of
      // this (org, year) until the process restarts.
      ;(runReportingPackImport as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("boom"),
      )
      const res = await POST(makeReq({ file: xlsxBlob(), year: "2026", apply: "1" }))
      expect(res.status).toBe(500)
      expect(release).toHaveBeenCalledTimes(1)
    })

    it("sanitises a lock-acquisition failure instead of throwing out of POST", async () => {
      // acquireImportLock dials its own pg connection. Outside a try this
      // escaped the route and Next rendered the raw pg message — which
      // carries host:port — defeating the sanitising catch entirely.
      ;(acquireImportLock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"),
      )
      const res = await POST(makeReq({ file: xlsxBlob(), year: "2026", apply: "1" }))
      const body = await res.json()
      expect(res.status).toBe(500)
      expect(JSON.stringify(body)).not.toContain("hunter2")
      expect(runReportingPackImport).not.toHaveBeenCalled()
    })

    it("a failing release does not turn a COMMITTED apply into an error", async () => {
      // A throw from `finally` DISCARDS the returned response. Unguarded, a
      // rejecting unlock reported a committed apply as a 500 — and the
      // operator re-runs the import, producing exactly the duplicate set this
      // lock exists to prevent.
      release.mockRejectedValueOnce(new Error("connection terminated"))
      const res = await POST(makeReq({ file: xlsxBlob(), year: "2026", apply: "1" }))
      expect(res.status).toBe(200)
      expect((await res.json()).mode).toBe("applied")
    })

    it("takes the lock BEFORE the importer runs, not after", async () => {
      // toHaveBeenCalledWith cannot see ordering: a refactor that acquired
      // AFTER the write would keep every other assertion green while the lock
      // protected nothing.
      await POST(makeReq({ file: xlsxBlob(), year: "2026", apply: "1" }))
      const lockOrder = (acquireImportLock as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]
      const runOrder = (runReportingPackImport as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]
      expect(lockOrder).toBeLessThan(runOrder)
    })

    // Guard — a preview writes nothing, so refusing concurrent previews would
    // be a regression, not a fix.
    it("does not take the lock on a preview", async () => {
      await POST(makeReq({ file: xlsxBlob(), year: "2026" }))
      expect(acquireImportLock).not.toHaveBeenCalled()
    })

    // Guard — the 11.34 period gate must stay IN FRONT of the new lock, or a
    // locked-period refusal would acquire and release for nothing.
    it("refuses a period-locked apply BEFORE taking the import lock", async () => {
      ;(getActivePeriodLock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        period: "2026",
      })
      const res = await POST(makeReq({ file: xlsxBlob(), year: "2026", apply: "1" }))
      expect(res.status).toBe(423)
      expect(acquireImportLock).not.toHaveBeenCalled()
    })
  })
})
