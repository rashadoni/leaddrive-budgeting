// @vitest-environment node
/**
 * Handler test for `/api/intel/morning-brief` (POST).
 *
 * Phase 7.E AI Morning Brief — composed CFO narrative. Locks
 * Anthropic-key guard, viewer auth, rate-limit, empty-payload
 * short-circuit, LLM error 502, and audit emission on real call.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, hasAnthropicKeyMock, runMorningBriefMock, logAuditEventMock, enforceRateLimitMock } = vi.hoisted(() => ({
  prismaMock: {
    auditEvent: { create: vi.fn() },
  },
  hasAnthropicKeyMock: vi.fn(),
  runMorningBriefMock: vi.fn(),
  logAuditEventMock: vi.fn(),
  enforceRateLimitMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/ai/client", () => ({ hasAnthropicKey: hasAnthropicKeyMock }))
vi.mock("@/lib/intel/morning-brief", () => ({
  runMorningBrief: runMorningBriefMock,
}))
vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: logAuditEventMock,
  buildAuditContext: vi.fn(() => ({})),
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: enforceRateLimitMock,
  getClientIp: vi.fn(() => "127.0.0.1"),
}))
vi.mock("@/lib/llm/prompts/morning-brief-system", () => ({
  MORNING_BRIEF_PROMPT_VERSION: "v1",
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { POST } from "./route"

const ORG_ID = "org_demo"

const NON_EMPTY_PAYLOAD = {
  worstCells: [{ companyCode: "AAC", indicatorCode: "IND_DSO", value: 90, unit: "days" }],
  topMovers: [{ companyCode: "AAC", indicatorCode: "IND_DSO", deltaPct: 15 }],
  activeAlerts: [{ severity: "warning", message: "DSO high" }],
  newsBullets: ["Sugar prices up 3%"],
}

beforeEach(() => {
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  hasAnthropicKeyMock.mockReset().mockReturnValue(true)
  runMorningBriefMock.mockReset().mockResolvedValue({
    headline: "Headline",
    narrative: "Narrative",
    priorityAction: "Action",
    usage: { input_tokens: 100, output_tokens: 50 },
  })
  logAuditEventMock.mockReset().mockResolvedValue({ ok: true })
  enforceRateLimitMock.mockReset().mockReturnValue(null)
})

describe("POST /api/intel/morning-brief", () => {
  it("503 when ANTHROPIC_API_KEY missing", async () => {
    hasAnthropicKeyMock.mockReturnValue(false)
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/intel/morning-brief", { method: "POST", json: NON_EMPTY_PAYLOAD }),
    )
    expect(res.status).toBe(503)
  })

  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await POST(
      makeRequest("/api/intel/morning-brief", { method: "POST", json: NON_EMPTY_PAYLOAD }),
    )
    expect(res.status).toBe(401)
  })

  it("429 rate-limited", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    enforceRateLimitMock.mockReturnValue(new Response("rate", { status: 429 }))
    const res = await POST(
      makeRequest("/api/intel/morning-brief", { method: "POST", json: NON_EMPTY_PAYLOAD }),
    )
    expect(res.status).toBe(429)
  })

  it("400 invalid JSON body", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const req = new Request("http://localhost/api/intel/morning-brief", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })

  it("200 short-circuits empty payload without LLM call", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/intel/morning-brief", {
        method: "POST",
        json: { worstCells: [], topMovers: [], activeAlerts: [], newsBullets: [] },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isEmpty).toBe(true)
    expect(runMorningBriefMock).not.toHaveBeenCalled()
    expect(logAuditEventMock).not.toHaveBeenCalled()
  })

  it("502 when runMorningBrief throws", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    runMorningBriefMock.mockRejectedValue(new Error("LLM provider down"))
    const res = await POST(
      makeRequest("/api/intel/morning-brief", { method: "POST", json: NON_EMPTY_PAYLOAD }),
    )
    expect(res.status).toBe(502)
  })

  it("200 happy path + audit emitted", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await POST(
      makeRequest("/api/intel/morning-brief", {
        method: "POST",
        json: { ...NON_EMPTY_PAYLOAD, language: "ru" },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.headline).toBe("Headline")
    expect(body.fromCache).toBe(false)
    expect(logAuditEventMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        event: expect.objectContaining({ action: "ai_morning_brief_run" }),
      }),
    )
  })
})
