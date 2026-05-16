/**
 * Handler tests for GET /api/admin/drift (Phase D.3 dashboard endpoint).
 * Mocks prisma + the freshness helper so the test exercises the route's
 * HTTP shape + cross-tenant guard + response composition without
 * hitting Postgres or the IntelDataPoint table.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock, freshnessMock, resolveSourcesMock } = vi.hoisted(() => ({
  prismaMock: {
    auditEvent: { findMany: vi.fn() },
    company: { findMany: vi.fn(), findUnique: vi.fn() },
    indicatorValue: { findFirst: vi.fn(), groupBy: vi.fn() },
  },
  freshnessMock: vi.fn(),
  // L3 closure 2026-05-16 — route now calls resolveFreshnessSources before
  // checkReferenceFreshness. Default to a single test-fixture source so
  // the through-pipe behavior matches production.
  resolveSourcesMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/intel/freshness", () => ({
  checkReferenceFreshness: freshnessMock,
  resolveFreshnessSources: resolveSourcesMock,
}));

import { mockSession } from "@/test/api-harness";
import { GET } from "./route";
import type { NextRequest } from "next/server";

async function makeRequest(): Promise<NextRequest> {
  const base = new Request("http://localhost/api/admin/drift");
  const { NextRequest } = await import("next/server");
  return new NextRequest(base);
}

const ORG_ID = "org_demo";

beforeEach(() => {
  prismaMock.auditEvent.findMany.mockReset().mockResolvedValue([]);
  prismaMock.company.findMany.mockReset().mockResolvedValue([]);
  prismaMock.company.findUnique.mockReset();
  prismaMock.indicatorValue.findFirst.mockReset().mockResolvedValue(null);
  prismaMock.indicatorValue.groupBy.mockReset().mockResolvedValue([]);
  freshnessMock.mockReset().mockResolvedValue([]);
  resolveSourcesMock.mockReset().mockResolvedValue([
    { sourceCode: "weather-openmeteo", cadence: "daily" },
  ]);
});

describe("GET /api/admin/drift", () => {
  it("401 when not authenticated", async () => {
    await mockSession(null);
    const res = await GET(await makeRequest());
    expect(res.status).toBe(401);
  });

  it("403 when role is not admin", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "viewer" });
    const res = await GET(await makeRequest());
    expect(res.status).toBe(403);
  });

  it("200 returns recentDrifts + referenceFreshness + stalePending", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" });
    prismaMock.auditEvent.findMany.mockResolvedValue([
      {
        id: "e1",
        createdAt: new Date("2026-05-10T10:00:00Z"),
        entityId: "co1",
        actor: { email: "rashad@audit", name: "Rashad" },
        metadata: { drifts: [{ indicatorCode: "FP_GROSS_MARGIN", valueDriftPct: 5 }] },
      },
    ]);
    prismaMock.company.findMany.mockResolvedValueOnce([
      { id: "co1", code: "AZSEKER-EDEN", name: "Eden", level: 2 },
    ]);
    // Inside the route, a 2nd findMany call lists all org companies for
    // the stalePending walk. Mock the SAME instance returns same array.
    prismaMock.company.findMany.mockResolvedValueOnce([
      { id: "co1", code: "AZSEKER-EDEN", name: "Eden", level: 2 },
      { id: "co2", code: "AZSEKER-FARM", name: "Farm", level: 2 },
      { id: "co3", code: "AZSEKER", name: "AzərŞəkər", level: 1 }, // level=1 skipped
    ]);
    // L5 batched: one groupBy returns max(lastReconciledAt) per leaf
    // companyId. co1 fresh, co2 absent from result (→ treated as null).
    prismaMock.indicatorValue.groupBy.mockResolvedValue([
      { companyId: "co1", _max: { lastReconciledAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) } },
    ]);
    freshnessMock.mockResolvedValue([
      { sourceCode: "weather-openmeteo", cadence: "daily", ageHours: 12, status: "fresh", metricCount: 3, lastFetchedAt: "2026-05-15T00:00:00Z", thresholds: { staleHours: 36, criticalHours: 72 } },
    ]);

    const res = await GET(await makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recentDrifts).toHaveLength(1);
    expect(body.recentDrifts[0].company.code).toBe("AZSEKER-EDEN");
    expect(body.recentDrifts[0].runBy).toBe("rashad@audit");
    expect(body.referenceFreshness).toHaveLength(1);
    expect(body.referenceFreshness[0].status).toBe("fresh");
    // stalePending: co2 (never audited) included; co3 (level 1) skipped
    // by the route's `if (c.level !== 2) continue`.
    const codes = body.stalePending.map((c: { code: string }) => c.code);
    expect(codes).toContain("AZSEKER-FARM");
    expect(codes).not.toContain("AZSEKER"); // level=1 filtered
  });

  it("falls back to metadata.runBy when actor relation is null (CLI runner)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" });
    prismaMock.auditEvent.findMany.mockResolvedValue([
      {
        id: "e2",
        createdAt: new Date(),
        entityId: "co1",
        actor: null,
        metadata: { drifts: [], runBy: "drift-watchdog" },
      },
    ]);
    prismaMock.company.findMany.mockResolvedValue([
      { id: "co1", code: "AZSEKER-EDEN", name: "Eden", level: 2 },
    ]);

    const res = await GET(await makeRequest());
    const body = await res.json();
    expect(body.recentDrifts[0].runBy).toBe("drift-watchdog");
  });
});
