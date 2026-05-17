// @vitest-environment node
/**
 * Handler test for `/api/budgeting/ai-analytics` (POST).
 *
 * Streamed Anthropic chat. Locks auth gate, 503 no key, Zod
 * validation, plan + company cross-tenant 404, and 500 on
 * section-context error.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const {
  prismaMock,
  hasAnthropicKeyMock,
  getAnthropicClientMock,
  collectSectionContextMock,
} = vi.hoisted(() => ({
  prismaMock: {
    budgetPlan: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
  },
  hasAnthropicKeyMock: vi.fn(),
  getAnthropicClientMock: vi.fn(),
  collectSectionContextMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/ai/client", () => ({
  hasAnthropicKey: hasAnthropicKeyMock,
  getAnthropicClient: getAnthropicClientMock,
  AI_MODEL: "claude-test-model",
}))
vi.mock("@/lib/ai/prompts", () => ({
  buildKickoffUserMessage: vi.fn(() => "kickoff"),
  buildSystemPrompt: vi.fn(() => "system prompt"),
}))
vi.mock("@/lib/ai/section-context", () => ({
  collectSectionContext: collectSectionContextMock,
}))
vi.mock("@/lib/ai/tools", () => ({
  AI_TOOLS: [],
  isCustomTool: vi.fn(() => false),
  runTool: vi.fn(),
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.budgetPlan.findFirst.mockReset().mockResolvedValue(null)
  prismaMock.company.findFirst.mockReset().mockResolvedValue(null)
  hasAnthropicKeyMock.mockReset().mockReturnValue(true)
  getAnthropicClientMock.mockReset().mockReturnValue({
    messages: { stream: vi.fn() },
  })
  collectSectionContextMock.mockReset().mockResolvedValue({})
})

describe("POST /api/budgeting/ai-analytics", () => {
  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/budgeting/ai-analytics", {
        method: "POST",
        json: { section: "pl", planId: "p1", messages: [] },
      }),
    )
    expect(res.status).toBe(401)
  })

  it("503 when ANTHROPIC_API_KEY missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    hasAnthropicKeyMock.mockReturnValue(false)
    const res = await POST(
      makeRequest("/api/budgeting/ai-analytics", {
        method: "POST",
        json: { section: "pl", planId: "p1", messages: [] },
      }),
    )
    expect(res.status).toBe(503)
  })

  it("400 invalid section enum", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/ai-analytics", {
        method: "POST",
        json: { section: "garbage", planId: "p1", messages: [] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("400 missing planId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/budgeting/ai-analytics", {
        method: "POST",
        json: { section: "pl", messages: [] },
      }),
    )
    expect(res.status).toBe(400)
  })

  it("404 plan cross-tenant", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/ai-analytics", {
        method: "POST",
        json: { section: "pl", planId: "p1", messages: [] },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("404 cross-tenant companyId", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: "p1" })
    prismaMock.company.findFirst.mockResolvedValue(null)
    const res = await POST(
      makeRequest("/api/budgeting/ai-analytics", {
        method: "POST",
        json: { section: "pl", planId: "p1", companyId: "c_evil", messages: [] },
      }),
    )
    expect(res.status).toBe(404)
  })

  it("500 when collectSectionContext throws", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: "p1" })
    collectSectionContextMock.mockRejectedValue(new Error("oops"))
    const res = await POST(
      makeRequest("/api/budgeting/ai-analytics", {
        method: "POST",
        json: { section: "pl", planId: "p1", messages: [] },
      }),
    )
    expect(res.status).toBe(500)
  })

  it("200 returns SSE Content-Type on happy validation path", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.budgetPlan.findFirst.mockResolvedValue({ id: "p1" })
    // Stream that immediately ends — no tokens, no tool-use
    const fakeStream = {
      [Symbol.asyncIterator]: async function* () { /* empty */ },
      finalMessage: () => Promise.resolve({ stop_reason: "end_turn", content: [] }),
    }
    getAnthropicClientMock.mockReturnValue({
      messages: { stream: vi.fn(() => fakeStream) },
    })
    const res = await POST(
      makeRequest("/api/budgeting/ai-analytics", {
        method: "POST",
        json: { section: "pl", planId: "p1", messages: [] },
      }),
    )
    expect(res.headers.get("Content-Type")).toBe("text/event-stream")
  })
})
