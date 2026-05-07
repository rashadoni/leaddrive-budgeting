// @vitest-environment node
/**
 * Phase C3 v2 — handler tests for `GET /api/budgeting/board-deck/export-pptx`.
 *
 * Locks: 401 unauth, 400 invalid period (gate fires before any DB hit),
 * 404 missing org, 200 returns the right Content-Type + non-empty body
 * + filename containing the org slug + period.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    organization: { findUnique: vi.fn() },
    company: { findMany: vi.fn() },
    indicatorDefinition: { findMany: vi.fn() },
    indicatorValue: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
// next-intl/server's `getTranslations` is async; for the handler test we
// just need a stub that returns the key back so localized output stays
// deterministic and the pptxgenjs render doesn't throw on missing keys.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => {
    const t = (k: string) => k;
    return t;
  }),
}));

// Phase 7.G E.2 — narrate-snapshot mock. By default the test suite
// assumes narration is OFF (no `?narrate=1`); when a test passes the
// flag we override `runNarration` with the resolved fixture below.
const { aiClientMock, narrateMock } = vi.hoisted(() => ({
  aiClientMock: { hasAnthropicKey: vi.fn().mockReturnValue(true) },
  narrateMock: { runNarration: vi.fn() },
}));
vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>(
    "@/lib/ai/client",
  );
  return { ...actual, ...aiClientMock };
});
vi.mock("@/lib/board-deck/narrate-snapshot", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/board-deck/narrate-snapshot")
  >("@/lib/board-deck/narrate-snapshot");
  return { ...actual, ...narrateMock };
});

import { mockSession, makeRequest } from "@/test/api-harness";
import { GET } from "./route";

const ORG_ID = "org_demo";

beforeEach(() => {
  prismaMock.organization.findUnique.mockReset().mockResolvedValue({
    name: "Demo Holding",
    slug: "demo",
    settings: null,
  });
  prismaMock.company.findMany.mockReset().mockResolvedValue([]);
  prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([]);
  prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([]);
  aiClientMock.hasAnthropicKey.mockReturnValue(true);
  narrateMock.runNarration.mockReset();
});

describe("GET /api/budgeting/board-deck/export-pptx", () => {
  it("returns 401 when unauthenticated", async () => {
    await mockSession(null);
    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pptx?period=2025"),
    );
    expect(res.status).toBe(401);
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
  });

  it("rejects malformed period with 400 — gate fires before any DB hit", async () => {
    await mockSession({
      orgId: ORG_ID,
      userId: "u1",
      role: "manager",
    });
    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pptx?period=garbage"),
    );
    expect(res.status).toBe(400);
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.company.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the org row is missing", async () => {
    await mockSession({
      orgId: ORG_ID,
      userId: "u1",
      role: "manager",
    });
    prismaMock.organization.findUnique.mockResolvedValue(null);
    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pptx?period=2025"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 200 with pptx Content-Type + Content-Disposition + non-empty body", async () => {
    await mockSession({
      orgId: ORG_ID,
      userId: "u1",
      role: "manager",
    });
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: "c1",
        code: "AAC",
        name: "AAC",
        industry: "hospitality",
        level: 2,
        isActive: true,
        role: "operational",
        sortOrder: 1,
      },
    ]);
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i1",
        code: "IND_GROSS_MARGIN",
        nameEn: "Gross Margin",
        direction: "higher_is_better",
        unit: "%",
        sortOrder: 1,
      },
    ]);
    prismaMock.indicatorValue.findMany.mockResolvedValue([
      {
        companyId: "c1",
        indicatorId: "i1",
        value: 60,
        status: "green",
      },
    ]);

    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pptx?period=2025"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(
      "presentationml.presentation",
    );
    const dispo = res.headers.get("content-disposition") ?? "";
    expect(dispo).toContain('filename="board-deck-demo-2025.pptx"');

    // PPTX is a ZIP archive — first 2 bytes are 'PK' (0x50 0x4B).
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(100);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("uses default period (current year) when ?period= omitted", async () => {
    await mockSession({
      orgId: ORG_ID,
      userId: "u1",
      role: "manager",
    });
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: "c1",
        code: "X",
        name: "X",
        industry: "agro",
        level: 2,
        isActive: true,
        role: "operational",
        sortOrder: 1,
      },
    ]);
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: "i1",
        code: "IND_X",
        nameEn: "X",
        direction: "higher_is_better",
        unit: "%",
        sortOrder: 1,
      },
    ]);

    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pptx"),
    );
    expect(res.status).toBe(200);
    // Period must reach IndicatorValue.findMany as a 4-digit string.
    const ivCall = prismaMock.indicatorValue.findMany.mock.calls[0]?.[0];
    expect(typeof ivCall.where.period).toBe("string");
    expect(ivCall.where.period).toMatch(/^\d{4}$/);
  });

  it("does NOT call runNarration when ?narrate is omitted (default off)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" });
    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pptx?period=2025"),
    );
    expect(res.status).toBe(200);
    expect(narrateMock.runNarration).not.toHaveBeenCalled();
  });

  it("calls runNarration with the resolved snapshot when ?narrate=1", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" });
    narrateMock.runNarration.mockResolvedValue({
      headline: "Hospitality recovery offsets industrial drag.",
      paragraphs: ["P1", "P2", "P3"],
      modelName: "claude-sonnet-4-5-20250929",
      promptVersion: "v1",
      usage: { inputTokens: 1500, outputTokens: 700 },
    });

    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pptx?period=2025&narrate=1"),
    );
    expect(res.status).toBe(200);
    expect(narrateMock.runNarration).toHaveBeenCalledTimes(1);
    const arg = narrateMock.runNarration.mock.calls[0][0];
    expect(arg.snapshot.org.name).toBe("Demo Holding");
    expect(arg.language).toBe("en"); // default
    // PPTX still ships even with narration on.
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("respects ?lang= query param when narrating", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" });
    narrateMock.runNarration.mockResolvedValue({
      headline: "x",
      paragraphs: ["a", "b", "c"],
      modelName: "m",
      promptVersion: "v1",
    });

    await GET(
      makeRequest(
        "/api/budgeting/board-deck/export-pptx?period=2025&narrate=1&lang=ru",
      ),
    );
    const arg = narrateMock.runNarration.mock.calls[0][0];
    expect(arg.language).toBe("ru");
  });

  it("renders deck WITHOUT narrative when runNarration throws (graceful degradation)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" });
    narrateMock.runNarration.mockRejectedValue(new Error("LLM down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pptx?period=2025&narrate=1"),
    );
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("skips narration entirely when ANTHROPIC_API_KEY missing", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "manager" });
    aiClientMock.hasAnthropicKey.mockReturnValue(false);

    const res = await GET(
      makeRequest("/api/budgeting/board-deck/export-pptx?period=2025&narrate=1"),
    );
    expect(res.status).toBe(200);
    expect(narrateMock.runNarration).not.toHaveBeenCalled();
  });
});
