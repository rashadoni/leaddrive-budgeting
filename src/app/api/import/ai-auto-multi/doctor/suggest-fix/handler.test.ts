// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const { budgetMock, aiMock } = vi.hoisted(() => ({
  budgetMock: {
    checkBudget: vi.fn(),
    recordUsage: vi.fn(),
  },
  aiMock: {
    create: vi.fn(),
    hasKey: vi.fn(),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/llm/cost-budget", () => budgetMock)
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(() => null),
  getClientIp: () => "127.0.0.1",
}))
vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "claude-test",
  hasAnthropicKey: () => aiMock.hasKey(),
  getAnthropicClient: () => ({ messages: { create: aiMock.create } }),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_import_doctor"

beforeEach(() => {
  aiMock.hasKey.mockReset().mockReturnValue(true)
  aiMock.create.mockReset().mockResolvedValue({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          kind: "sheet_fix",
          executable: true,
          title: "Route CPC sheet",
          rationale: "The sheet label contains CPC.",
          confidence: 0.92,
          risk: "low",
          patch: {
            filename: "actual.xlsx",
            sheetName: "PLF CPC",
            entityCode: "AZSEKER-CPC",
          },
        }),
      },
    ],
    usage: { input_tokens: 110, output_tokens: 40 },
  })
  budgetMock.checkBudget.mockReset().mockResolvedValue({
    ok: true,
    remaining: { daily: 1, monthly: 1 },
  })
  budgetMock.recordUsage.mockReset().mockResolvedValue(undefined)
})

describe("POST /api/import/ai-auto-multi/doctor/suggest-fix", () => {
  it("requires admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" })
    const res = await POST(
      makeRequest("/api/import/ai-auto-multi/doctor/suggest-fix", {
        method: "POST",
        json: {
          issue: { code: "routing_uncertain", message: "x" },
          context: {},
        },
      }),
    )
    expect(res.status).toBe(403)
    expect(aiMock.create).not.toHaveBeenCalled()
  })

  it("returns a safe proposal and records usage", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await POST(
      makeRequest("/api/import/ai-auto-multi/doctor/suggest-fix", {
        method: "POST",
        json: {
          locale: "az",
          issue: {
            code: "routing_uncertain",
            severity: "warning",
            message: "routing",
          },
          context: {
            guidedFixItems: [
              {
                filename: "actual.xlsx",
                classification: { sheetName: "PLF CPC" },
              },
            ],
          },
        },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.proposal).toMatchObject({
      kind: "sheet_fix",
      executable: true,
      requiresPreviewRerun: true,
      patch: {
        filename: "actual.xlsx",
        sheetName: "PLF CPC",
        entityCode: "AZSEKER-CPC",
      },
    })
    expect(budgetMock.recordUsage).toHaveBeenCalledWith(ORG_ID, {
      inputTokens: 110,
      outputTokens: 40,
    })
  })

  it("returns 429 when budget gate blocks the call", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    budgetMock.checkBudget.mockResolvedValueOnce({
      ok: false,
      reason: "daily",
      resetAt: new Date("2026-07-02T00:00:00.000Z"),
      cap: 1,
      used: 1,
    })
    const res = await POST(
      makeRequest("/api/import/ai-auto-multi/doctor/suggest-fix", {
        method: "POST",
        json: {
          issue: { code: "routing_uncertain", message: "x" },
          context: {},
        },
      }),
    )
    expect(res.status).toBe(429)
    expect(aiMock.create).not.toHaveBeenCalled()
  })
})
