/**
 * Handler tests for `/api/budgeting/availability` (Turn 33.5 Item 7 full).
 *
 * Closes the architect Round-1 ⚠️ gap from Turn 29 — availability route
 * shipped without unit tests covering: 401 unauth, count → boolean
 * mapping, hardcoded-true tabs, Cache-Control header.
 *
 * Mocks: `@/lib/auth` (NextAuth) + `@/lib/prisma` (9 count surfaces).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    budgetLine: { count: vi.fn() },
    salesBudgetLine: { count: vi.fn() },
    cOGSBudgetLine: { count: vi.fn() },
    balanceSheetLine: { count: vi.fn() },
    cashFlowEntry: { count: vi.fn() },
    budgetAssumption: { count: vi.fn() },
    salesForecast: { count: vi.fn() },
    expenseForecast: { count: vi.fn() },
    rollingForecastMonth: { count: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { mockSession, makeRequest } from "@/test/api-harness";
import { GET } from "./route";

const ORG_ID = "org_az";

beforeEach(() => {
  // Default all counts to 0 — individual tests override what they care about.
  for (const m of Object.values(prismaMock)) m.count.mockReset().mockResolvedValue(0);
});

describe("GET /api/budgeting/availability (Turn 33.5)", () => {
  it("401 when unauthenticated", async () => {
    await mockSession(null);
    const res = await GET(makeRequest("http://localhost/api/budgeting/availability"));
    expect(res.status).toBe(401);
  });

  it("returns flat tabKey → boolean map for empty org (only hardcoded-true tabs)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" });
    const res = await GET(makeRequest("http://localhost/api/budgeting/availability"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Tabs depending on data → false (all counts mocked to 0)
    expect(body["pnl-report"]).toBe(false);
    expect(body["sales-budget"]).toBe(false);
    expect(body.cogs).toBe(false);
    expect(body["balance-sheet"]).toBe(false);
    expect(body["cash-flow"]).toBe(false);
    expect(body.assumptions).toBe(false);
    expect(body.workspace).toBe(false);
    expect(body.pl).toBe(false);
    expect(body.forecast).toBe(false);
    expect(body["sales-forecast"]).toBe(false);
    expect(body["expense-forecast"]).toBe(false);
    expect(body.rolling).toBe(false);
    expect(body["report-builder"]).toBe(false);
    // Hardcoded-true tabs (handle their own empty state)
    expect(body.comparison).toBe(true);
    expect(body.plans).toBe(true);
    expect(body.integrations).toBe(true);
    expect(body.config).toBe(true);
  });

  it("budgetLine count > 0 enables pnl-report + workspace + pl + forecast + report-builder", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" });
    prismaMock.budgetLine.count.mockResolvedValue(568);
    const res = await GET(makeRequest("http://localhost/api/budgeting/availability"));
    const body = await res.json();
    expect(body["pnl-report"]).toBe(true);
    expect(body.workspace).toBe(true);
    expect(body.pl).toBe(true);
    expect(body.forecast).toBe(true);
    expect(body["report-builder"]).toBe(true);
    // Other domain tabs still false (their counts not mocked)
    expect(body["sales-budget"]).toBe(false);
  });

  it("each domain count maps to its tab independently", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" });
    prismaMock.salesBudgetLine.count.mockResolvedValue(87);
    prismaMock.cOGSBudgetLine.count.mockResolvedValue(87);
    prismaMock.balanceSheetLine.count.mockResolvedValue(2664);
    prismaMock.cashFlowEntry.count.mockResolvedValue(1316);
    prismaMock.budgetAssumption.count.mockResolvedValue(50);
    prismaMock.salesForecast.count.mockResolvedValue(12);
    prismaMock.expenseForecast.count.mockResolvedValue(20);
    prismaMock.rollingForecastMonth.count.mockResolvedValue(36);
    const res = await GET(makeRequest("http://localhost/api/budgeting/availability"));
    const body = await res.json();
    expect(body["sales-budget"]).toBe(true);
    expect(body.cogs).toBe(true);
    expect(body["balance-sheet"]).toBe(true);
    expect(body["cash-flow"]).toBe(true);
    expect(body.assumptions).toBe(true);
    expect(body["sales-forecast"]).toBe(true);
    expect(body["expense-forecast"]).toBe(true);
    expect(body.rolling).toBe(true);
  });

  it("Cache-Control header set to private max-age=30 (Turn 33 architect ⚠️ closure)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" });
    const res = await GET(makeRequest("http://localhost/api/budgeting/availability"));
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
  });

  it("all 9 prisma.count calls scope by organizationId (security regression guard)", async () => {
    await mockSession({ orgId: ORG_ID, userId: "u1", role: "admin" });
    await GET(makeRequest("http://localhost/api/budgeting/availability"));
    for (const [name, model] of Object.entries(prismaMock)) {
      expect(model.count, `${name}.count called with orgId`).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID },
      });
    }
  });
});
