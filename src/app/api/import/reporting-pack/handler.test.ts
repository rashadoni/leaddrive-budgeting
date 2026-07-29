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
import { POST } from "./route"

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
    // entityCode AZSEKER-AZSF → companyId c1, year 2026
    expect(runRecomputeForCompanies).toHaveBeenCalledWith(
      expect.anything(),
      "org1",
      [{ companyId: "c1", year: 2026 }],
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
})
