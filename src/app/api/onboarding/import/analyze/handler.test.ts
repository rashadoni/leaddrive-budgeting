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
// Phase C C2.4 — default to the single-company path (findEntityColumn → null)
// so the pre-existing tests are unaffected; the multi-entity test overrides.
vi.mock("@/lib/onboarding/ai-mapper/entity-split", () => ({
  findEntityColumn: vi.fn(() => null),
  findCodeColumn: vi.fn(() => 0),
  extractEntityValues: vi.fn(() => []),
}))
vi.mock("@/lib/onboarding/ai-mapper/entity-resolve", () => ({
  resolveEntityCompanies: vi.fn(() => ({ suggestions: {}, unresolved: [] })),
  looksLikeEliminationBU: vi.fn((v: string) => /^(eje|aje|cons|consolidated)$/i.test(v.trim())),
  SKIP_ENTITY: "__SKIP__",
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      findFirst: vi.fn(async () => ({ id: "c1", code: "AAA", name: "Co", industry: "x" })),
      findMany: vi.fn(async () => [
        { id: "c1", code: "AZSF", name: "Aze Sheker Farm" },
        { id: "c2", code: "EDEN", name: "Eden Agro" },
      ]),
    },
    importStaging: { create: vi.fn(async () => ({ id: "st1", expiresAt: new Date(0) })) },
    // Phase B template lookup — default: no approved template (settings empty)
    // so analyze falls through to the LLM mapper as before.
    organization: { findUnique: vi.fn(async () => ({ settings: {} })) },
  },
}))

import { requireRole } from "@/lib/api-auth"
import { recordUsage } from "@/lib/llm/cost-budget"
import { runMapper } from "@/lib/onboarding/ai-mapper/mapper"
import { computeStructureHash } from "@/lib/onboarding/ai-mapper/structure-hash"
import { computeWorkbookContentHash } from "@/lib/onboarding/ai-mapper/workbook-content-hash"
import { findEntityColumn, extractEntityValues } from "@/lib/onboarding/ai-mapper/entity-split"
import { resolveEntityCompanies } from "@/lib/onboarding/ai-mapper/entity-resolve"
import { prisma } from "@/lib/prisma"
import { POST } from "./route"

// Hash of the fixed mapperInput the extract mock returns — keys the template.
const FIXED_HASH = computeStructureHash({
  sourceFile: "x.xlsx",
  sourceSheet: "PL",
  columns: [{ index: 0, headerText: "Code", samples: ["601"] }],
  sampleRows: [],
})

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

  it("400s on missing file / sheetName", async () => {
    expect((await POST(makeReq({ sheetName: "PL", companyId: "c1" }))).status).toBe(400)
    expect((await POST(makeReq({ file: xlsx(), companyId: "c1" }))).status).toBe(400)
  })

  it("requires a company for single-company sheets when no BU/entity column exists", async () => {
    const res = await POST(makeReq({ file: xlsx(), sheetName: "PL" }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/Select the target company/)
    expect(prisma.importStaging.create).not.toHaveBeenCalled()
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
    expect(createArg.data.proposal.__workbookContentSha256).toBe(
      computeWorkbookContentHash(new Uint8Array([1, 2, 3])),
    )
    expect(createArg.data.expiresAt).toBeInstanceOf(Date)
    expect(recordUsage).toHaveBeenCalled()
  })

  it("detects an entity column → persists __multiEntity + returns entityValues/suggestions", async () => {
    ;(findEntityColumn as ReturnType<typeof vi.fn>).mockReturnValueOnce(1)
    ;(extractEntityValues as ReturnType<typeof vi.fn>).mockReturnValueOnce(["AZSF", "EDEN"])
    ;(resolveEntityCompanies as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      suggestions: { AZSF: "c1", EDEN: "c2" },
      unresolved: [],
    })
    const res = await POST(makeReq({ file: xlsx(), sheetName: "PL", companyId: "c1" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.multiEntity).toBe(true)
    expect(body.entityValues).toEqual(["AZSF", "EDEN"])
    expect(body.entitySuggestions).toEqual({ AZSF: "c1", EDEN: "c2" })
    // Persisted reviewed set (the apply route re-checks this at commit).
    const createArg = (prisma.importStaging.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createArg.data.proposal.__multiEntity).toEqual({
      entityColumnIndex: 1,
      entityValues: ["AZSF", "EDEN"],
    })
    expect(prisma.company.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org1" },
      select: { id: true, code: true, name: true },
    })
  })

  it("allows no selected company for multi-entity sheets and uses an anchor only for staging", async () => {
    ;(findEntityColumn as ReturnType<typeof vi.fn>).mockReturnValueOnce(1)
    ;(extractEntityValues as ReturnType<typeof vi.fn>).mockReturnValueOnce(["AZSF", "EDEN"])
    ;(resolveEntityCompanies as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      suggestions: { AZSF: "c1", EDEN: "c2" },
      unresolved: [],
    })
    const res = await POST(makeReq({ file: xlsx(), sheetName: "PL" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.multiEntity).toBe(true)
    expect(body.company.autoSelected).toBe(true)
    const createArg = (prisma.importStaging.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createArg.data.companyId).toBe("c1")
    expect(createArg.data.proposal.__multiEntity.entityValues).toEqual(["AZSF", "EDEN"])
  })

  it("single-company sheet (no entity column) → multiEntity false, no __multiEntity persisted", async () => {
    const res = await POST(makeReq({ file: xlsx(), sheetName: "PL", companyId: "c1" }))
    const body = await res.json()
    expect(body.multiEntity).toBe(false)
    expect(body.entityValues).toBeUndefined()
    const createArg = (prisma.importStaging.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createArg.data.proposal.__multiEntity).toBeUndefined()
    expect(prisma.company.findMany).not.toHaveBeenCalled()
  })

  it("reuses an approved template (skips the LLM) when the structure-hash matches", async () => {
    ;(prisma.organization.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      settings: {
        importTemplates: {
          [FIXED_HASH]: [
            {
              structureHash: FIXED_HASH,
              sheetName: "PL",
              // role "label" ≠ the LLM mock's "code" → proves it came from the template
              mapping: { columns: [{ sourceIndex: 0, role: "label", confidence: 1, reasoning: "" }], accountTypeOverrides: [] },
              approvedBy: "u9",
              approvedAt: "2026-06-20T00:00:00Z",
              version: 3,
              sourceFile: "prev.xlsx",
            },
          ],
        },
      },
    })
    const res = await POST(makeReq({ file: xlsx(), sheetName: "PL", companyId: "c1" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.fromTemplate).toBe(true)
    expect(body.proposal.columns[0].role).toBe("label") // from template
    expect(runMapper).not.toHaveBeenCalled() // LLM skipped
    expect(recordUsage).not.toHaveBeenCalled() // no tokens spent
    // Phase 11.27 — `anomalies` must be an ARRAY produced from THIS file's
    // data, not the hardcoded [] it used to be. A template supplies the
    // column mapping; it says nothing about the numbers in the new workbook.
    expect(Array.isArray(body.proposal.anomalies)).toBe(true)
  })

  it("flags a template override whose code is absent from THIS file", async () => {
    // The overrides were inferred from the workbook the template was approved
    // on. Replaying one for a code this sheet never mentions silently types an
    // account the file does not contain.
    ;(prisma.organization.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      settings: {
        importTemplates: {
          [FIXED_HASH]: [
            {
              structureHash: FIXED_HASH,
              sheetName: "PL",
              mapping: {
                columns: [{ sourceIndex: 0, role: "label", confidence: 1, reasoning: "" }],
                accountTypeOverrides: [
                  {
                    code: "NOT-IN-THIS-FILE",
                    accountType: "expense",
                    confidence: 0.9,
                    reasoning: "from the original workbook",
                  },
                ],
              },
              approvedBy: "u9",
              approvedAt: "2026-06-20T00:00:00Z",
              version: 3,
              sourceFile: "prev.xlsx",
            },
          ],
        },
      },
    })
    const res = await POST(makeReq({ file: xlsx(), sheetName: "PL", companyId: "c1" }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(
      body.proposal.anomalies.some((a: { description: string }) =>
        a.description.includes("NOT-IN-THIS-FILE"),
      ),
    ).toBe(true)
  })
})
