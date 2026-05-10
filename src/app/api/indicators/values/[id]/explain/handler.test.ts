/**
 * Phase 7.E AI-suite — handler test for `POST /api/indicators/values/[id]/explain`.
 *
 * Mirrors the `companies/[id]/handler.test.ts` pattern (auth gate +
 * tenant scoping + audit emission verify). The Variance Explainer is
 * the first AI-suite endpoint to land an audit_event — Turn 38 sub-turn
 * 8 closure of architect-flagged AI-suite audit-coverage gap.
 *
 * What this proves:
 *  1. `runExplainer()` is mocked (no real LLM call in tests).
 *  2. Audit gap closure: every successful explain emits exactly one
 *     `ai_variance_explainer_run` audit_event with the expected metadata
 *     shape (indicatorCode + companyId + period + status + language +
 *     tokens + durationMs).
 *  3. Audit emission is non-blocking: even when the audit insert throws,
 *     the explainer response still goes back to the caller (compliance
 *     gap surfaces via background scan, not a hard failure).
 *  4. ANTHROPIC_API_KEY missing → 503 short-circuits BEFORE any DB read.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    indicatorValue: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { aiClientMock } = vi.hoisted(() => ({
  aiClientMock: { hasAnthropicKey: vi.fn().mockReturnValue(true) },
}));
vi.mock("@/lib/ai/client", () => aiClientMock);

const { runExplainerMock } = vi.hoisted(() => ({ runExplainerMock: vi.fn() }));
vi.mock("@/lib/risk/variance-explainer", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/risk/variance-explainer")
  >("@/lib/risk/variance-explainer");
  return { ...actual, runExplainer: runExplainerMock };
});

const { rateLimitMock } = vi.hoisted(() => ({
  rateLimitMock: {
    enforceRateLimit: vi.fn().mockReturnValue(null),
    getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  },
}));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>(
    "@/lib/rate-limit",
  );
  return { ...actual, ...rateLimitMock };
});

import { mockSession, makeRequest } from "@/test/api-harness";
import { POST } from "./route";

const IV_ID = "iv_aac_net_margin";
const ORG_ID = "org_az";
const COMPANY_ID = "co_aac_main";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

const ivRow = {
  id: IV_ID,
  value: -9.46,
  status: "red" as const,
  period: "2026",
  inputs: { resolved: { revenue: 18_604_520, cogs: 15_788_098 }, aggregates: {} },
  companyId: COMPANY_ID,
  indicator: {
    code: "IND_NET_MARGIN",
    nameEn: "Net Margin",
    unit: "%",
    direction: "higher_better",
    hintTemplateEn: "Net margin {value} below threshold",
  },
  company: { name: "AAC Main", industry: "industrial" },
};

const explainerOutput = {
  narrative: "AAC Main lost AZN 1.76M on AZN 18.6M revenue (–9.5% margin)…",
  recommendations: ["Freeze OpEx", "Renegotiate suppliers", "Audit product mix"],
  confidence: "high" as const,
  topDrivers: ["total_cost", "cogs", "opex"],
  usage: { inputTokens: 905, outputTokens: 249 },
  modelName: "claude-sonnet-4-5-20250929",
  promptVersion: "v2",
};

beforeEach(() => {
  prismaMock.indicatorValue.findFirst.mockReset();
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "audit_1" });
  runExplainerMock.mockReset();
  aiClientMock.hasAnthropicKey.mockReturnValue(true);
  rateLimitMock.enforceRateLimit.mockReset().mockReturnValue(null);
});

describe("POST /api/indicators/values/[id]/explain — handler", () => {
  it("returns 503 when ANTHROPIC_API_KEY is missing — short-circuit before DB read", async () => {
    aiClientMock.hasAnthropicKey.mockReturnValue(false);
    const req = makeRequest(`/api/indicators/values/${IV_ID}/explain`, {
      method: "POST",
      json: {},
    });
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(503);
    expect(prismaMock.indicatorValue.findFirst).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    await mockSession(null);
    const req = makeRequest(`/api/indicators/values/${IV_ID}/explain`, {
      method: "POST",
      json: {},
    });
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(401);
    expect(prismaMock.indicatorValue.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 (not 403) when IV belongs to a different org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(null);
    const req = makeRequest(`/api/indicators/values/${IV_ID}/explain`, {
      method: "POST",
      json: {},
    });
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(404);
    const call = prismaMock.indicatorValue.findFirst.mock.calls[0][0];
    expect(call.where).toEqual({ id: IV_ID, organizationId: ORG_ID });
  });

  it("returns 400 when status is 'green' — nothing to explain", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      ...ivRow,
      status: "green",
    });
    const req = makeRequest(`/api/indicators/values/${IV_ID}/explain`, {
      method: "POST",
      json: {},
    });
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(400);
    expect(runExplainerMock).not.toHaveBeenCalled();
  });

  it("emits ai_variance_explainer_run audit_event on successful explain", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(ivRow);
    runExplainerMock.mockResolvedValue(explainerOutput);

    const req = makeRequest(`/api/indicators/values/${IV_ID}/explain`, {
      method: "POST",
      json: { language: "ru" },
      headers: { "user-agent": "TestRunner/1.0" },
    });
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.indicatorValueId).toBe(IV_ID);
    expect(body.narrative).toBe(explainerOutput.narrative);

    // Audit emission happens after JSON serialization; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const auditCall = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe("ai_variance_explainer_run");
    expect(auditCall.data.entityType).toBe("IndicatorValue");
    expect(auditCall.data.entityId).toBe(IV_ID);
    expect(auditCall.data.organizationId).toBe(ORG_ID);
    expect(auditCall.data.actorUserId).toBe("u_cfo");
    expect(auditCall.data.metadata).toMatchObject({
      indicatorCode: "IND_NET_MARGIN",
      companyId: COMPANY_ID,
      period: "2026",
      status: "red",
      language: "ru",
      tokensIn: 905,
      tokensOut: 249,
      modelName: "claude-sonnet-4-5-20250929",
      promptVersion: "v2",
    });
    expect(typeof auditCall.data.metadata.durationMs).toBe("number");
    expect(auditCall.data.context).toMatchObject({
      route: "/api/indicators/values/[id]/explain",
      userAgent: "TestRunner/1.0",
    });
  });

  it("non-blocking: explain response still 200 even when audit insert throws", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(ivRow);
    runExplainerMock.mockResolvedValue(explainerOutput);
    prismaMock.auditEvent.create.mockRejectedValue(new Error("audit DB down"));

    const req = makeRequest(`/api/indicators/values/${IV_ID}/explain`, {
      method: "POST",
      json: {},
    });
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.narrative).toBe(explainerOutput.narrative);
  });
});
