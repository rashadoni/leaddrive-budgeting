/**
 * Phase 7.G — companyId propagation tests.
 *
 * Locks the contract that:
 *  - `computePL` adds `companyId` to its Prisma where-clause when the
 *    user picked a company in the budgeting page (the SPARK→AZMADE
 *    bug fix).
 *  - Sections backed by plan-wide tables (balance-sheet etc.) DON'T
 *    silently drop the company filter — they relay a `scope` note in
 *    the data blob so the LLM qualifies its narrative.
 *  - The route's `collectSectionContext` orchestrator passes the
 *    companyId through to the right compute fn.
 *
 * Pure data-layer test — mocks `@/lib/prisma` so we can assert the
 * shape of every `where` clause without a real database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const budgetLineFindMany = vi.fn();
const balanceSheetLineFindMany = vi.fn();
const budgetPlanFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetLine: { findMany: (...a: unknown[]) => budgetLineFindMany(...a) },
    balanceSheetLine: {
      findMany: (...a: unknown[]) => balanceSheetLineFindMany(...a),
    },
    budgetPlan: {
      findFirst: (...a: unknown[]) => budgetPlanFindFirst(...a),
    },
    cashFlowEntry: { findMany: vi.fn().mockResolvedValue([]) },
    cOGSBudgetLine: { findMany: vi.fn().mockResolvedValue([]) },
    cOGSCostDetail: { findMany: vi.fn().mockResolvedValue([]) },
    budgetAssumption: { findMany: vi.fn().mockResolvedValue([]) },
    budgetForecastEntry: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// Stub coa-role helpers — they don't exercise companyId, just return
// finite numbers so computePL's downstream math works.
vi.mock("@/lib/budgeting/coa-role", () => ({
  deriveRoleFromCode: () => "revenue",
  isContraRevenueCode: () => false,
  pnlSectionFromRole: (r: string) => r,
}));

beforeEach(() => {
  budgetLineFindMany.mockReset();
  balanceSheetLineFindMany.mockReset();
  budgetPlanFindFirst.mockReset();

  budgetLineFindMany.mockResolvedValue([]);
  balanceSheetLineFindMany.mockResolvedValue([]);
  budgetPlanFindFirst.mockResolvedValue({
    id: "plan_1",
    name: "AZMADE 2026",
    year: 2026,
    periodType: "annual",
    status: "active",
  });
});

describe("collectSectionContext — companyId propagation (Phase 7.G)", () => {
  it("computePL passes companyId into budgetLine where-clause", async () => {
    const { collectSectionContext } = await import("./section-context");
    await collectSectionContext(
      "pl",
      "org_1",
      "plan_1",
      "co_spark",
      "SPARK · SPARK Tech LLC",
    );
    expect(budgetLineFindMany).toHaveBeenCalledTimes(1);
    const args = budgetLineFindMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      organizationId: "org_1",
      planId: "plan_1",
      companyId: "co_spark",
    });
  });

  it("computePL drops companyId when null (consolidated view)", async () => {
    const { collectSectionContext } = await import("./section-context");
    await collectSectionContext("pl", "org_1", "plan_1", null, null);
    const args = budgetLineFindMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      organizationId: "org_1",
      planId: "plan_1",
    });
    // The load-bearing assertion: NO companyId key when the user
    // didn't pick one. Adding a `companyId: undefined` would still
    // pass `toMatchObject` but a literal absence prevents Prisma
    // from accidentally filtering on undefined → null.
    expect(args.where.companyId).toBeUndefined();
  });

  it("computePL returns scope='Scoped to company: …' when companyId set", async () => {
    const { collectSectionContext } = await import("./section-context");
    const data = (await collectSectionContext(
      "pl",
      "org_1",
      "plan_1",
      "co_spark",
      "SPARK · SPARK Tech LLC",
    )) as { scope: string | null };
    expect(data.scope).toMatch(/SPARK/);
    expect(data.scope).toMatch(/Scoped to company/i);
  });

  it("computePL returns null scope when no company picked", async () => {
    const { collectSectionContext } = await import("./section-context");
    const data = (await collectSectionContext(
      "pl",
      "org_1",
      "plan_1",
      null,
      null,
    )) as { scope: string | null };
    expect(data.scope).toBeNull();
  });

  it("balance-sheet does NOT add companyId to where (table has no companyId column)", async () => {
    const { collectSectionContext } = await import("./section-context");
    await collectSectionContext(
      "balance-sheet",
      "org_1",
      "plan_1",
      "co_spark",
      "SPARK · SPARK Tech LLC",
    );
    expect(balanceSheetLineFindMany).toHaveBeenCalledTimes(1);
    const args = balanceSheetLineFindMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      organizationId: "org_1",
      planId: "plan_1",
    });
    expect(args.where.companyId).toBeUndefined();
  });

  it("balance-sheet returns a scope note when company picked (LLM must qualify narrative)", async () => {
    const { collectSectionContext } = await import("./section-context");
    const data = (await collectSectionContext(
      "balance-sheet",
      "org_1",
      "plan_1",
      "co_spark",
      "SPARK · SPARK Tech LLC",
    )) as { scope: string | null };
    expect(data.scope).toBeTruthy();
    // Critical: the note must call out that the underlying table is
    // plan-wide so the LLM doesn't claim a SPARK-specific BS.
    expect(data.scope!.toLowerCase()).toContain("plan-wide");
    expect(data.scope).toMatch(/SPARK/);
  });

  it("balance-sheet scope is null when no company picked", async () => {
    const { collectSectionContext } = await import("./section-context");
    const data = (await collectSectionContext(
      "balance-sheet",
      "org_1",
      "plan_1",
      null,
      null,
    )) as { scope: string | null };
    expect(data.scope).toBeNull();
  });
});
