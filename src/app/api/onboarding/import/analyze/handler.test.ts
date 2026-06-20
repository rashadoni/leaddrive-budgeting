/**
 * Route tests for POST /api/onboarding/import/analyze (the keystone producer).
 * Mocks auth / rate-limit / budget / mapper / prisma so the test exercises
 * only the route wiring (validation, company scope, staging creation).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { MapperInput, MappingProposal } from "@/lib/onboarding/ai-mapper/types"

vi.mock("@/lib/api-auth", () => ({
  requireRole: vi.fn(),
  isAuthError: (r: unknown) => r instanceof Response,
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(() => null),
  getClientIp: vi.fn(() => "1.2.3.4"),
}))
vi.mock("@/lib/llm/cost-budget", () => ({
  checkBudget: vi.fn(async () => ({ ok: true })),
  recordUsage: vi.fn(async () => {}),
}))
vi.mock("@/lib/ai/ai-error", () => ({ aiErrorBody: () => ({ error: "sanitised" }) }))
vi.mock("xlsx", () => ({ read: vi.fn(() => ({ Sheets: { PL: {} }, SheetNames: ["PL"] })) }))
vi.mock("@/lib/onboarding/ai-mapper/extract", () => ({
  extractMapperInput: vi.fn(
    (): MapperInput => ({
      sourceFile: "x.xlsx",
      sourceSheet: "PL",
      columns: [{ index: 0, headerText: "Code", samples: ["601"] }],
      sampleRows: [],
    }),
  ),
}))
vi.mock("@/lib/onboarding/ai-mapper/mapper", () => ({
  runMapper: vi.fn(
    async (): Promise<MappingProposal> => ({
      sourceFile: "x.xlsx",
      sourceSheet: "PL",
      columns: [{ sourceIndex: 0, role: "code", confidence: 0.9, reasoning: "looks like codes" }],
      anomalies: [],
      overallConfidence: 0.9,
      summary: "P&L sheet",
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  ),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn(async () => ({ id: "c1", code: "AAA", name: "Co", industry: "x" })) },
    importStaging: { create: vi.fn(async () => ({ id: "st1", expiresAt: new Date(0) })) },
  },
}))

import { requireRole } from "@/lib/api-auth"
import { recordUsage } from "@/lib/llm/cost-budget"
import { prisma } from "@/lib/prisma"
import { POST } from "./route"

const SESSION = { userId: "u1", orgId: "org1", role: "manager" as const }

function makeReq(fields: Record<string, string | Blob>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Blob) fd.append(k, v, "x.xlsx")
    else fd.append(k, v)
  }
  return new Request("http://t/api/onboarding/import/analyze", { method: "POST", body: fd }) as never
}
const xlsx = () => new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" })

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireRole as ReturnType<typeof vi.fn>).mockResolvedValue(SESSION)
})

describe("POST /api/onboarding/import/analyze", () => {
  it("rejects non-managers", async () => {
    ;(requireRole as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 403 }))
    const res = await POST(makeReq({ file: xlsx(), sheetName: "PL", companyId: "c1" }))
    expect(res.status).toBe(403)
  })

  it("400s on missing file / sheetName / companyId", async () => {
    expect((await POST(makeReq({ sheetName: "PL", companyId: "c1" }))).status).toBe(400)
    expect((await POST(makeReq({ file: xlsx(), companyId: "c1" }))).status).toBe(400)
    expect((await POST(makeReq({ file: xlsx(), sheetName: "PL" }))).status).toBe(400)
  })

  it("404s when the company is not in the org", async () => {
    ;(prisma.company.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const res = await POST(makeReq({ file: xlsx(), sheetName: "PL", companyId: "zzz" }))
    expect(res.status).toBe(404)
  })

  it("creates a staging row and returns proposal + sourceColumns", async () => {
    const res = await POST(makeReq({ file: xlsx(), sheetName: "PL", companyId: "c1" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.stagingId).toBe("st1")
    expect(body.proposal.columns[0].role).toBe("code")
    expect(body.sourceColumns[0].headerText).toBe("Code")
    // staging persisted with the right scope
    const createArg = (prisma.importStaging.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createArg.data.organizationId).toBe("org1")
    expect(createArg.data.companyId).toBe("c1")
    expect(createArg.data.createdBy).toBe("u1")
    expect(createArg.data.sourceSheet).toBe("PL")
    expect(createArg.data.expiresAt).toBeInstanceOf(Date)
    expect(recordUsage).toHaveBeenCalled()
  })
})
