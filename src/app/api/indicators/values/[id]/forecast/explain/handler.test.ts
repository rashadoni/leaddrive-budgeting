/**
 * Phase C2 v2 (sub-22) — handler test for
 * `POST /api/indicators/values/[id]/forecast/explain`.
 *
 * Mirror of `/explain/handler.test.ts` (Variance Explainer audit-coverage
 * pattern). Verifies:
 *  1. `runForecastExplainer()` mocked — no real LLM call.
 *  2. Audit emission: every successful run produces exactly one
 *     `ai_forecast_explainer_run` audit_event with the new metadata
 *     shape (forecastConfidence + forecastR2 + contributingCount).
 *  3. Audit emission non-blocking even when the insert throws.
 *  4. ANTHROPIC_API_KEY missing → 503 short-circuit before DB read.
 *  5. 400 when sparkline has <3 non-null points (insufficient data).
 *  6. 400 when sparkline missing entirely.
 *  7. Cross-tenant 404 (no leak).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    indicatorValue: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue({ allowedSubGroupIds: [] }) },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { aiClientMock } = vi.hoisted(() => ({
  aiClientMock: {
    hasAnthropicKey: vi.fn().mockReturnValue(true),
    hasAnthropicKeyForOrg: vi.fn().mockResolvedValue(true),
    getAnthropicClientForOrg: vi
      .fn()
      .mockResolvedValue({ messages: { create: vi.fn() } }),
  },
}));
vi.mock("@/lib/ai/client", () => aiClientMock);

const { runForecastExplainerMock } = vi.hoisted(() => ({
  runForecastExplainerMock: vi.fn(),
}));
vi.mock("@/lib/risk/forecast-explainer", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/risk/forecast-explainer")
  >("@/lib/risk/forecast-explainer");
  return { ...actual, runForecastExplainer: runForecastExplainerMock };
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
  value: 12.5,
  status: "green" as const,
  period: "2026",
  // 12 trailing-month sparkline with clear downward slope.
  sparkline: [13, 12.6, 12.2, 11.8, 11.4, 11, 10.7, 10.3, 10, 9.8, 9.6, 9.5],
  companyId: COMPANY_ID,
  indicator: {
    code: "IND_NET_MARGIN",
    nameEn: "Net Margin",
    unit: "%",
    direction: "higher_better",
    hintTemplateEn: "Net margin {value}%",
  },
  company: {
    name: "AAC Main",
    industry: "industrial",
    role: "operational",
    level: 2,
  },
};

const explainerOutput = {
  narrative:
    "Net margin trending from 13% to forecast 9.5% — a 3.5pp compression over 12 months driven by COGS inflation.",
  driverHypotheses: [
    "COGS inflation +18% YoY",
    "Revenue ramp slower than cost ramp",
  ],
  riskFactors: [
    "Iran sanctions tightening would push feedstock cost +20%",
    "AZN devaluation 15% would compress import margins further",
  ],
  confidence: 0.78,
  usage: { inputTokens: 220, outputTokens: 95 },
  modelName: "claude-sonnet-4-5-20250929",
  promptVersion: "v1",
};

beforeEach(() => {
  prismaMock.indicatorValue.findFirst.mockReset();
  prismaMock.auditEvent.create
    .mockReset()
    .mockResolvedValue({ id: "audit_1" });
  runForecastExplainerMock.mockReset();
  aiClientMock.hasAnthropicKey.mockReturnValue(true);
  aiClientMock.hasAnthropicKeyForOrg.mockResolvedValue(true);
  aiClientMock.getAnthropicClientForOrg.mockResolvedValue({
    messages: { create: vi.fn() },
  });
  rateLimitMock.enforceRateLimit.mockReset().mockReturnValue(null);
});

describe("POST /api/indicators/values/[id]/forecast/explain — handler", () => {
  it("returns 503 when no Anthropic key (env + per-org both unset) — short-circuit before DB read", async () => {
    // Phase 8 C4 — key check now considers both env + per-org. Auth
    // happens first; if authed but no key anywhere, still 503.
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    aiClientMock.hasAnthropicKey.mockReturnValue(false);
    aiClientMock.hasAnthropicKeyForOrg.mockResolvedValue(false);
    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(503);
    expect(prismaMock.indicatorValue.findFirst).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    await mockSession(null);
    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(401);
    expect(prismaMock.indicatorValue.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 (not 403) when IV belongs to a different org", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(null);
    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(404);
    const call = prismaMock.indicatorValue.findFirst.mock.calls[0][0];
    expect(call.where).toEqual({ id: IV_ID, organizationId: ORG_ID });
  });

  it("returns 400 when sparkline missing — insufficient data for forecast", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      ...ivRow,
      sparkline: null,
    });
    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Insufficient sparkline data");
    expect(runForecastExplainerMock).not.toHaveBeenCalled();
  });

  it("returns 400 when sparkline has <3 non-null points", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      ...ivRow,
      sparkline: [10, null, null, null, null, 12, null, null, null, null, null, null],
    });
    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(400);
    expect(runForecastExplainerMock).not.toHaveBeenCalled();
  });

  it("emits ai_forecast_explainer_run audit_event on successful run", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(ivRow);
    runForecastExplainerMock.mockResolvedValue(explainerOutput);

    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      {
        method: "POST",
        json: { language: "ru" },
        headers: { "user-agent": "TestRunner/1.0" },
      },
    );
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.indicatorValueId).toBe(IV_ID);
    expect(body.narrative).toBe(explainerOutput.narrative);
    expect(body.driverHypotheses).toEqual(explainerOutput.driverHypotheses);
    expect(body.riskFactors).toEqual(explainerOutput.riskFactors);

    // Phase 7.O C3 — fact-check now wired into forecast route too.
    expect(body.factCheck).toBeDefined();
    expect(Array.isArray(body.factCheck.flags)).toBe(true);
    expect(typeof body.factCheck.totalChecked).toBe("number");
    expect(typeof body.factCheck.matched).toBe("number");

    // Audit emission happens via .catch; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    const auditCall = prismaMock.auditEvent.create.mock.calls[0][0];
    expect(auditCall.data.action).toBe("ai_forecast_explainer_run");
    expect(auditCall.data.entityType).toBe("IndicatorValue");
    expect(auditCall.data.entityId).toBe(IV_ID);
    expect(auditCall.data.organizationId).toBe(ORG_ID);
    expect(auditCall.data.actorUserId).toBe("u_cfo");
    expect(auditCall.data.metadata).toMatchObject({
      indicatorCode: "IND_NET_MARGIN",
      companyId: COMPANY_ID,
      period: "2026",
      language: "ru",
      forecastConfidence: "high", // perfect-line slope-(-0.4) → high
      tokensIn: 220,
      tokensOut: 95,
      modelName: "claude-sonnet-4-5-20250929",
      promptVersion: "v1",
    });
    expect(typeof auditCall.data.metadata.durationMs).toBe("number");
    expect(typeof auditCall.data.metadata.forecastR2).toBe("number");
    expect(auditCall.data.metadata.contributingCount).toBe(12);
    expect(auditCall.data.context).toMatchObject({
      route: "/api/indicators/values/[id]/forecast/explain",
      userAgent: "TestRunner/1.0",
    });
  });

  it("non-blocking: forecast response still 200 even when audit insert throws", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(ivRow);
    runForecastExplainerMock.mockResolvedValue(explainerOutput);
    prismaMock.auditEvent.create.mockRejectedValue(new Error("audit DB down"));

    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.narrative).toBe(explainerOutput.narrative);
  });

  it("response surfaces predictionInterval (sub-24 CI contract)", async () => {
    // Architect sub-24 ⚠️ closure: lock the wire-format contract so a
    // future refactor can't silently drop the predictionInterval field.
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(ivRow); // 12-pt clean descending series
    runForecastExplainerMock.mockResolvedValue(explainerOutput);
    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.predictionInterval).toBeDefined();
    expect(body.predictionInterval.level).toBe(0.95);
    expect(typeof body.predictionInterval.lower).toBe("number");
    expect(typeof body.predictionInterval.upper).toBe("number");
    expect(typeof body.predictionInterval.marginOfError).toBe("number");
    expect(typeof body.predictionInterval.standardError).toBe("number");
    // df = n - 2 = 12 - 2 = 10 for the 12-point ivRow sparkline.
    expect(body.predictionInterval.degreesOfFreedom).toBe(10);
    // Lower < upper invariant.
    expect(body.predictionInterval.lower).toBeLessThanOrEqual(
      body.predictionInterval.upper,
    );
  });

  it("response surfaces multi-step horizon (sub-23 contract)", async () => {
    // Lock horizon wire-format alongside CI — both shipped this week,
    // both surfaced via the same JSON response.
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(ivRow);
    runForecastExplainerMock.mockResolvedValue(explainerOutput);
    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    const res = await POST(req, paramsFor(IV_ID));
    const body = await res.json();
    expect(Array.isArray(body.horizon)).toBe(true);
    expect(body.horizon).toHaveLength(3); // default 3 steps from sub-23
    expect(body.horizon[0]).toMatchObject({ step: 1 });
    expect(body.horizon[2]).toMatchObject({ step: 3 });
  });

  it("default language is 'en' when body omits language", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(ivRow);
    runForecastExplainerMock.mockResolvedValue(explainerOutput);

    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    await POST(req, paramsFor(IV_ID));

    const callInput = runForecastExplainerMock.mock.calls[0][0];
    expect(callInput.language).toBe("en");
  });

  it("invalid language falls back to 'en'", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(ivRow);
    runForecastExplainerMock.mockResolvedValue(explainerOutput);

    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: { language: "fr" } },
    );
    await POST(req, paramsFor(IV_ID));

    const callInput = runForecastExplainerMock.mock.calls[0][0];
    expect(callInput.language).toBe("en");
  });

  it("derives tags from Company.role='admin' → ['admin','cost_centre']", async () => {
    // Architect sub-22 💡 closure: tags previously hard-coded `[]`,
    // making prompt's tag-aware branch dead. Verify role='admin'
    // produces the expected tag set fed into ForecastExplainerInput.
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      ...ivRow,
      company: { name: "ATL-MRKZ", industry: null, role: "admin", level: 2 },
    });
    runForecastExplainerMock.mockResolvedValue(explainerOutput);
    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    await POST(req, paramsFor(IV_ID));
    const callInput = runForecastExplainerMock.mock.calls[0][0];
    expect(callInput.company.tags).toEqual(["admin", "cost_centre"]);
  });

  it("derives tags from level=1 sub-group → ['rollup_sourced']", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue({
      ...ivRow,
      company: {
        name: "AAC Group",
        industry: "Industrial",
        role: "operational",
        level: 1,
      },
    });
    runForecastExplainerMock.mockResolvedValue(explainerOutput);
    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    await POST(req, paramsFor(IV_ID));
    const callInput = runForecastExplainerMock.mock.calls[0][0];
    expect(callInput.company.tags).toEqual(["rollup_sourced"]);
  });

  it("operational level=2 (default) gets empty tags", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(ivRow); // role=operational, level=2
    runForecastExplainerMock.mockResolvedValue(explainerOutput);
    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    await POST(req, paramsFor(IV_ID));
    const callInput = runForecastExplainerMock.mock.calls[0][0];
    expect(callInput.company.tags).toEqual([]);
  });

  it("returns 502 when runForecastExplainer throws (LLM-side failure)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    prismaMock.indicatorValue.findFirst.mockResolvedValue(ivRow);
    runForecastExplainerMock.mockRejectedValue(
      new Error("max_tokens exceeded"),
    );

    const req = makeRequest(
      `/api/indicators/values/${IV_ID}/forecast/explain`,
      { method: "POST", json: {} },
    );
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(502);
    const body = await res.json();
    // Sanitized — stable code only, NEVER the raw provider message.
    expect(body.error).toBe("ai_unavailable");
    expect(body.code).toBeDefined();
    expect(JSON.stringify(body)).not.toContain("max_tokens");
  });

  it("returns 400 on malformed JSON body", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u_cfo", role: "manager" });
    const req = new Request(
      `http://localhost/api/indicators/values/${IV_ID}/forecast/explain`,
      {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      },
    ) as never;
    const res = await POST(req, paramsFor(IV_ID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid JSON body");
  });
});
