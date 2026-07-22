// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hasKeyMock,
  rateMock,
  scopeMock,
  snapshotMock,
  generateMock,
  getClientMock,
  hasOrgKeyMock,
} = vi.hoisted(() => ({
  hasKeyMock: vi.fn(),
  rateMock: vi.fn(),
  scopeMock: vi.fn(),
  snapshotMock: vi.fn(),
  generateMock: vi.fn(),
  getClientMock: vi.fn(),
  hasOrgKeyMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ai/client", () => ({
  hasAnthropicKey: hasKeyMock,
  hasAnthropicKeyForOrg: hasOrgKeyMock,
  getAnthropicClientForOrg: getClientMock,
}));
vi.mock("@/lib/db/prisma-admin", () => ({ prismaAdmin: {} }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: rateMock,
  getClientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/rbac/company-scope", () => ({ getCompanyScope: scopeMock }));
vi.mock("@/lib/board-deck/build-snapshot", () => ({
  buildBoardSnapshot: snapshotMock,
}));
vi.mock("@/lib/board-deck/get-or-create-narration", () => ({
  getOrCreateNarration: generateMock,
}));

import { makeRequest, mockSession } from "@/test/api-harness";
import { POST } from "./route";

const BODY = {
  userInitiated: true,
  period: "2026",
  language: "ru",
  regenerate: false,
};

beforeEach(() => {
  hasKeyMock.mockReset().mockReturnValue(true);
  rateMock.mockReset().mockReturnValue(null);
  scopeMock.mockReset().mockResolvedValue({
    ids: new Set(["c-visible"]),
    bypassed: false,
  });
  snapshotMock.mockReset().mockResolvedValue({ period: "2026" });
  generateMock.mockReset().mockResolvedValue({
    headline: "h",
    paragraphs: ["a", "b", "c"],
    modelName: "m",
    promptVersion: "v1",
  });
  getClientMock.mockReset().mockResolvedValue({});
  hasOrgKeyMock.mockReset().mockResolvedValue(false);
});

describe("POST /api/budgeting/board-deck/narration", () => {
  it("requires authentication and manager role", async () => {
    await mockSession(null);
    expect(
      (await POST(makeRequest("/api/budgeting/board-deck/narration", {
        method: "POST",
        json: BODY,
      }))).status,
    ).toBe(401);

    await mockSession({ orgId: "org", userId: "viewer", role: "viewer" });
    expect(
      (await POST(makeRequest("/api/budgeting/board-deck/narration", {
        method: "POST",
        json: BODY,
      }))).status,
    ).toBe(403);
    expect(hasKeyMock).not.toHaveBeenCalled();
  });

  it("fails closed without explicit intent before key, rate, reads or AI", async () => {
    await mockSession({ orgId: "org", userId: "manager", role: "manager" });
    const res = await POST(makeRequest("/api/budgeting/board-deck/narration", {
      method: "POST",
      json: { ...BODY, userInitiated: false },
    }));
    expect(res.status).toBe(428);
    expect(hasKeyMock).not.toHaveBeenCalled();
    expect(rateMock).not.toHaveBeenCalled();
    expect(scopeMock).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("returns 503 without a configured paid provider key before tenant reads", async () => {
    await mockSession({ orgId: "org", userId: "manager", role: "manager" });
    hasKeyMock.mockReturnValue(false);
    const res = await POST(makeRequest("/api/budgeting/board-deck/narration", {
      method: "POST",
      json: BODY,
    }));
    expect(res.status).toBe(503);
    expect(scopeMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("validates exact period and language before key lookup or rate budget", async () => {
    await mockSession({ orgId: "org", userId: "manager", role: "manager" });
    const missingPeriod = await POST(makeRequest("/api/budgeting/board-deck/narration", {
      method: "POST",
      json: { ...BODY, period: undefined },
    }));
    expect(missingPeriod.status).toBe(400);
    const badLanguage = await POST(makeRequest("/api/budgeting/board-deck/narration", {
      method: "POST",
      json: { ...BODY, language: "fr" },
    }));
    expect(badLanguage.status).toBe(400);
    expect(hasKeyMock).not.toHaveBeenCalled();
    expect(hasOrgKeyMock).not.toHaveBeenCalled();
    expect(rateMock).not.toHaveBeenCalled();
  });

  it("accepts an organization-scoped key without a global key", async () => {
    await mockSession({ orgId: "org", userId: "manager", role: "manager" });
    hasKeyMock.mockReturnValue(false);
    hasOrgKeyMock.mockResolvedValue(true);
    const res = await POST(makeRequest("/api/budgeting/board-deck/narration", {
      method: "POST",
      json: BODY,
    }));
    expect(res.status).toBe(200);
    expect(hasOrgKeyMock).toHaveBeenCalled();
    expect(getClientMock).toHaveBeenCalled();
  });

  it("enforces the paid-action rate limit before scoped snapshot reads", async () => {
    await mockSession({ orgId: "org", userId: "manager", role: "manager" });
    rateMock.mockReturnValue(new Response("rate limited", { status: 429 }));
    const res = await POST(makeRequest("/api/budgeting/board-deck/narration", {
      method: "POST",
      json: BODY,
    }));
    expect(res.status).toBe(429);
    expect(scopeMock).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("builds a subgroup-scoped snapshot and generates only after explicit action", async () => {
    await mockSession({ orgId: "org", userId: "manager", role: "manager" });
    const res = await POST(makeRequest("/api/budgeting/board-deck/narration", {
      method: "POST",
      json: BODY,
    }));
    expect(res.status).toBe(200);
    expect(snapshotMock).toHaveBeenCalledWith({
      orgId: "org",
      period: "2026",
      companyIds: ["c-visible"],
    });
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org",
        language: "ru",
      }),
      expect.objectContaining({ bypassCache: false }),
    );
  });

  it("honours explicit regenerate and rejects truthy non-boolean input before key/rate", async () => {
    await mockSession({ orgId: "org", userId: "manager", role: "manager" });
    await POST(makeRequest("/api/budgeting/board-deck/narration", {
      method: "POST",
      json: { ...BODY, regenerate: true },
    }));
    expect(generateMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ bypassCache: true }),
    );

    generateMock.mockClear();
    hasKeyMock.mockClear();
    rateMock.mockClear();
    const invalid = await POST(makeRequest("/api/budgeting/board-deck/narration", {
      method: "POST",
      json: { ...BODY, regenerate: "true" },
    }));
    expect(invalid.status).toBe(400);
    expect(hasKeyMock).not.toHaveBeenCalled();
    expect(rateMock).not.toHaveBeenCalled();
    expect(generateMock).not.toHaveBeenCalled();
  });
});
