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
}))
vi.mock("@/lib/onboarding/adapters/reporting-pack-importer", () => ({
  runReportingPackImport: vi.fn(),
}))
vi.mock("@/lib/risk/recompute-trigger", () => ({
  runRecomputeForCompanies: vi.fn(async () => ({ ok: 1, unknown: 0, failed: 0, targets: 1 })),
}))

import { requireRole } from "@/lib/api-auth"
import { runReportingPackImport } from "@/lib/onboarding/adapters/reporting-pack-importer"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"
import { POST } from "./route"

const SESSION = { userId: "u1", orgId: "org1", role: "admin" as const }

function makeReq(fields: Record<string, string | Blob>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
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
})
