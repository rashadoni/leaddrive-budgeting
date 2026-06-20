/**
 * Route tests for POST /api/onboarding/import/analyze-multi (multi-sheet producer).
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
vi.mock("xlsx", () => ({
  read: vi.fn(() => ({ Sheets: { PL1: {}, PL2: {} }, SheetNames: ["PL1", "PL2"] })),
  utils: { decode_range: vi.fn(() => ({ s: { r: 0, c: 0 }, e: { r: 10, c: 5 } })) },
}))
vi.mock("@/lib/onboarding/ai-mapper/extract", () => ({
  extractMapperInput: vi.fn(
    (_wb: unknown, sheetName: string): MapperInput => ({
      sourceFile: "x.xlsx",
      sourceSheet: sheetName,
      columns: [{ index: 0, headerText: "Code", samples: ["601"] }],
      sampleRows: [],
    }),
  ),
}))
vi.mock("@/lib/onboarding/ai-mapper/mapper", () => ({
  runMapper: vi.fn(
    async (input: MapperInput): Promise<MappingProposal> => ({
      sourceFile: "x.xlsx",
      sourceSheet: input.sourceSheet,
      columns: [{ sourceIndex: 0, role: "code", confidence: 0.9, reasoning: "codes" }],
      anomalies: [],
      overallConfidence: 0.9,
      summary: "P&L",
      usage: { inputTokens: 80, outputTokens: 40 },
    }),
  ),
}))
vi.mock("@/lib/onboarding/ai-mapper/structure-hash", () => ({
  computeStructureHash: vi.fn(() => "hash"),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn(async () => ({ id: "c1", code: "AAA", name: "Co", industry: "x" })) },
    importStaging: { create: vi.fn(async () => ({ id: "st1", expiresAt: new Date(0) })) },
  },
}))

import { requireRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { POST } from "./route"

const SESSION = { userId: "u1", orgId: "org1", role: "manager" as const }
function makeReq(fields: Record<string, string | Blob>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Blob) fd.append(k, v, "x.xlsx")
    else fd.append(k, v)
  }
  return new Request("http://t/api/onboarding/import/analyze-multi", { method: "POST", body: fd }) as never
}
const xlsx = () => new Blob([new Uint8Array([1])], { type: "application/octet-stream" })

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireRole as ReturnType<typeof vi.fn>).mockResolvedValue(SESSION)
})

describe("POST /api/onboarding/import/analyze-multi", () => {
  it("400s with fewer than 2 sheet names", async () => {
    const res = await POST(makeReq({ file: xlsx(), sheetNames: "PL1", companyId: "c1" }))
    expect(res.status).toBe(400)
  })

  it("builds a MultiSheetProposal staging across sheets", async () => {
    const res = await POST(makeReq({ file: xlsx(), sheetNames: "PL1, PL2", companyId: "c1" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.multi).toBe(true)
    expect(body.sheets.map((s: { sheetName: string }) => s.sheetName)).toEqual(["PL1", "PL2"])
    expect(body.sheets[0].proposal.columns[0].role).toBe("code")
    expect(body.sheets[0].sourceColumns[0].headerText).toBe("Code")
    // staging proposal is the multi shape with a combined structure hash
    const createArg = (prisma.importStaging.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createArg.data.proposal.sheets).toHaveLength(2)
    expect(createArg.data.proposal.__structureHash).toBe("hash|hash")
  })
})
