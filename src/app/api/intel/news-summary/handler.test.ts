// @vitest-environment node
/**
 * Handler test for `/api/intel/news-summary` (GET).
 *
 * Phase 7.H Feature 1 — Today's Brief LLM summarization. Locks
 * Anthropic-key guard, viewer-only, rate-limit envelope, sub-group
 * RBAC filter, and audit emission on LLM call.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const { prismaMock, hasAnthropicKeyMock, runNewsSummaryMock, logAuditEventMock, getCompanyScopeMock, enforceRateLimitMock } = vi.hoisted(() => ({
  prismaMock: {
    intelItem: { findMany: vi.fn() },
    company: { findMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  hasAnthropicKeyMock: vi.fn(),
  runNewsSummaryMock: vi.fn(),
  logAuditEventMock: vi.fn(),
  getCompanyScopeMock: vi.fn(),
  enforceRateLimitMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
// Stage 3 RLS — hand the mock straight to the scope callback.
vi.mock("@/lib/db/with-org-scope", () => ({
  withOrgScope: async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prismaMock),
}))
vi.mock("@/lib/ai/client", () => ({ hasAnthropicKey: hasAnthropicKeyMock }))
vi.mock("@/lib/intel/news-summary", () => ({
  runNewsSummary: runNewsSummaryMock,
}))
vi.mock("@/lib/audit/log", () => ({
  logAuditEvent: logAuditEventMock,
  buildAuditContext: vi.fn(() => ({})),
}))
vi.mock("@/lib/rbac/company-scope", () => ({
  getCompanyScope: getCompanyScopeMock,
}))
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: enforceRateLimitMock,
  getClientIp: vi.fn(() => "127.0.0.1"),
}))
vi.mock("@/lib/llm/prompts/news-summary-system", () => ({
  NEWS_SUMMARY_PROMPT_VERSION: "v1",
}))

import { mockSession, makeRequest } from "@/test/api-harness"
import { GET } from "./route"

const ORG_ID = "org_demo"

beforeEach(() => {
  prismaMock.intelItem.findMany.mockReset().mockResolvedValue([])
  prismaMock.company.findMany.mockReset().mockResolvedValue([])
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" })
  hasAnthropicKeyMock.mockReset().mockReturnValue(true)
  runNewsSummaryMock.mockReset().mockResolvedValue({
    bullets: ["Bullet 1", "Bullet 2"],
    usage: { input_tokens: 100, output_tokens: 50 },
  })
  logAuditEventMock.mockReset().mockResolvedValue({ ok: true })
  getCompanyScopeMock.mockReset().mockResolvedValue({ ids: null })
  enforceRateLimitMock.mockReset().mockReturnValue(null)
})

describe("GET /api/intel/news-summary", () => {
  it("503 when ANTHROPIC_API_KEY missing", async () => {
    hasAnthropicKeyMock.mockReturnValue(false)
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/intel/news-summary?userInitiated=1"))
    expect(res.status).toBe(503)
  })

  it("401 unauthenticated", async () => {
    await mockSession(null)
    const res = await GET(makeRequest("/api/intel/news-summary?userInitiated=1"))
    expect(res.status).toBe(401)
  })

  it("429 on rate-limit", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    enforceRateLimitMock.mockReturnValue(new Response("rate limited", { status: 429 }))
    const res = await GET(makeRequest("/api/intel/news-summary?userInitiated=1"))
    expect(res.status).toBe(429)
  })

  it("200 happy path — bullets from runNewsSummary + audit emitted", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    prismaMock.intelItem.findMany.mockResolvedValue([
      {
        id: "i1", title: "Sugar prices up", summary: "...", url: "https://x",
        sourceLabel: "WB", relevanceScore: 0.9,
        industryTags: ["agro_crops"], companyTags: [], publishedAt: new Date(),
      },
    ])
    const res = await GET(makeRequest("/api/intel/news-summary?language=ru&userInitiated=1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bullets).toEqual(["Bullet 1", "Bullet 2"])
    expect(body.fromCache).toBe(false)
    expect(logAuditEventMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        event: expect.objectContaining({ action: "ai_news_summary_run" }),
      }),
    )
  })

  it("sub-group RBAC filters out items with off-scope companyTags", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    getCompanyScopeMock.mockResolvedValue({ ids: new Set(["c1"]) })
    prismaMock.company.findMany.mockResolvedValue([{ code: "AAC" }]) // c1 → "AAC"
    prismaMock.intelItem.findMany.mockResolvedValue([
      { id: "i1", title: "AAC item", summary: "", url: "", sourceLabel: "", relevanceScore: 0.8, industryTags: [], companyTags: ["AAC"], publishedAt: null },
      { id: "i2", title: "Other-co item", summary: "", url: "", sourceLabel: "", relevanceScore: 0.8, industryTags: [], companyTags: ["OTHER"], publishedAt: null },
      { id: "i3", title: "Macro item",   summary: "", url: "", sourceLabel: "", relevanceScore: 0.8, industryTags: [], companyTags: [], publishedAt: null },
    ])
    await GET(makeRequest("/api/intel/news-summary?userInitiated=1"))
    // runNewsSummary should be called with i1 (AAC tag) + i3 (no tags) only
    const items = runNewsSummaryMock.mock.calls[0][0].items
    expect(items).toHaveLength(2)
    expect(items.map((i: { title: string }) => i.title)).toEqual(
      expect.arrayContaining(["AAC item", "Macro item"]),
    )
  })

  it("english default when language param missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    await GET(makeRequest("/api/intel/news-summary?userInitiated=1"))
    expect(runNewsSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en" }),
    )
  })

  it("428 without explicit user action and never reaches paid AI plumbing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" })
    const res = await GET(makeRequest("/api/intel/news-summary?language=en"))
    expect(res.status).toBe(428)
    expect(hasAnthropicKeyMock).not.toHaveBeenCalled()
    expect(enforceRateLimitMock).not.toHaveBeenCalled()
    expect(prismaMock.intelItem.findMany).not.toHaveBeenCalled()
    expect(runNewsSummaryMock).not.toHaveBeenCalled()
  })
})
