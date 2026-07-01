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
          title: "Conflict",
          plainExplanation: "Two files disagree on one cell.",
          whyBlocked: "The importer cannot choose the correct value safely.",
          whatToCheck: ["Source workbook date", "Cell owner"],
          safeNextStep: "Pick a source and rerun preview.",
          needsReimport: false,
        }),
      },
    ],
    usage: { input_tokens: 100, output_tokens: 30 },
  })
  budgetMock.checkBudget.mockReset().mockResolvedValue({
    ok: true,
    remaining: { daily: 1, monthly: 1 },
  })
  budgetMock.recordUsage.mockReset().mockResolvedValue(undefined)
})

describe("POST /api/import/ai-auto-multi/doctor/explain", () => {
  it("requires admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/import/ai-auto-multi/doctor/explain", {
        method: "POST",
        json: {
          issue: { code: "import_failed", message: "x" },
          context: {},
        },
      }),
    )
    expect(res.status).toBe(403)
    expect(aiMock.create).not.toHaveBeenCalled()
  })

  it("rejects invalid payload", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await POST(
      makeRequest("/api/import/ai-auto-multi/doctor/explain", {
        method: "POST",
        json: { issue: { code: "import_failed" } },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns sanitized unavailable when AI key is missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    aiMock.hasKey.mockReturnValue(false)
    const res = await POST(
      makeRequest("/api/import/ai-auto-multi/doctor/explain", {
        method: "POST",
        json: {
          issue: { code: "import_failed", message: "x" },
          context: {},
        },
      }),
    )
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, error: "ai_unavailable" })
  })

  it("returns explanation and records usage", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    const res = await POST(
      makeRequest("/api/import/ai-auto-multi/doctor/explain", {
        method: "POST",
        json: {
          locale: "ru",
          issue: {
            code: "cross_file_conflict",
            severity: "blocking",
            message: "conflict",
          },
          context: { conflicts: [{ key: "k1" }] },
        },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.explanation.title).toBe("Conflict")
    expect(aiMock.create).toHaveBeenCalledOnce()
    expect(budgetMock.recordUsage).toHaveBeenCalledWith(ORG_ID, {
      inputTokens: 100,
      outputTokens: 30,
    })
  })

  it("sanitizes malformed provider output", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" })
    aiMock.create.mockResolvedValueOnce({
      content: [{ type: "text", text: "{\"bad\":true}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const res = await POST(
      makeRequest("/api/import/ai-auto-multi/doctor/explain", {
        method: "POST",
        json: {
          issue: { code: "import_failed", message: "x" },
          context: {},
        },
      }),
    )
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe("ai_unavailable")
  })
})
