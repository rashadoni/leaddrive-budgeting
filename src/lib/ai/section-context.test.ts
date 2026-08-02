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
const balanceSheetLineCount = vi.fn();
const budgetPlanFindFirst = vi.fn();
const companyFindMany = vi.fn();
const cashFlowEntryFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    budgetLine: { findMany: (...a: unknown[]) => budgetLineFindMany(...a) },
    balanceSheetLine: {
      findMany: (...a: unknown[]) => balanceSheetLineFindMany(...a),
      count: (...a: unknown[]) => balanceSheetLineCount(...a),
    },
    budgetPlan: {
      findFirst: (...a: unknown[]) => budgetPlanFindFirst(...a),
    },
    company: { findMany: (...a: unknown[]) => companyFindMany(...a) },
    cashFlowEntry: { findMany: (...a: unknown[]) => cashFlowEntryFindMany(...a) },
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
  balanceSheetLineCount.mockReset();
  budgetPlanFindFirst.mockReset();
  companyFindMany.mockReset();
  cashFlowEntryFindMany.mockReset();

  budgetLineFindMany.mockResolvedValue([]);
  balanceSheetLineFindMany.mockResolvedValue([]);
  balanceSheetLineCount.mockResolvedValue(0);
  budgetPlanFindFirst.mockResolvedValue({
    id: "plan_1",
    name: "AZMADE 2026",
    year: 2026,
    kind: "actual",
    periodType: "annual",
    status: "active",
  });
  // No level-1 holding by default — the default fixture is a plain
  // single-plan read, so the holding branch stays out of the way.
  companyFindMany.mockResolvedValue([]);
  cashFlowEntryFindMany.mockResolvedValue([]);
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

  it("balance-sheet DOES scope to the requested company (the column exists — Phase 7.O)", async () => {
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
      companyId: "co_spark",
    });
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

  it("cash-flow narration excludes CF.04–CF.07 bridge evidence from movement totals", async () => {
    cashFlowEntryFindMany.mockResolvedValue([
      { activityType: "operating", entryType: "inflow", amount: 100, month: 1 },
      { activityType: "bridge", entryType: "inflow", amount: 100, month: 1 },
      { activityType: "bridge", entryType: "inflow", amount: 1_000, month: 1 },
    ]);
    const { collectSectionContext } = await import("./section-context");
    const data = (await collectSectionContext(
      "cash-flow",
      "org_1",
      "plan_1",
      null,
      null,
    )) as {
      byActivity: Record<string, number>;
      monthly: Record<string, number>;
      netCashFlow: number;
    };

    expect(data.byActivity).toEqual({ operating: 100, investing: 0, financing: 0 });
    expect(data.monthly).toEqual({ "1": 100 });
    expect(data.netCashFlow).toBe(100);
  });
});

/**
 * 14.7 (2026-08-03) — "Balans cədvəlində heç bir məlumat mövcud deyil.
 * Aktivlər = 0 AZN" said the AI panel, beside a table reading 364.1M.
 *
 * Three separate faults produced that one sentence. Each test below fails on
 * its own if the corresponding fault comes back, because fixing any two of
 * them still leaves the panel wrong — and the third one is the dangerous
 * direction: a confident wrong number instead of a visible zero.
 */
type BSData = {
  source: {
    readFromPlanId: string;
    fellBackToActuals: boolean;
    note: string | null;
    asOfMonth: number | null;
    asOfNote: string;
    rowCount: number;
  };
  basis: {
    kind: string;
    entityCount: number;
    eliminationsApplied: boolean;
    note: string | null;
  };
  totals: {
    asOfMonth: number | null;
    assets: number | null;
    liabilities: number | null;
    equity: number | null;
    debtToEquity: number | null;
  };
  topAssets: Array<{ name: string; amount: number }>;
  topLiabilities: Array<{ name: string; amount: number }>;
};

/**
 * One entity's balanced month, in the client's trial-balance convention
 * (assets positive, liabilities and equity negative) — the convention the
 * real `BS Actual 2026` sheet is written in.
 */
const entityMonth = (companyId: string, month: number, assets: number) => [
  {
    id: `${companyId}-a-${month}`,
    companyId,
    lineType: "asset",
    month,
    amount: assets,
    accountId: "acct-a",
    account: { code: "BS.01.02.01", name: "Cash and Cash Equivalents" },
  },
  {
    id: `${companyId}-l-${month}`,
    companyId,
    lineType: "liability",
    month,
    amount: -0.3 * assets,
    accountId: "acct-l",
    account: { code: "BS.03.02.03.01", name: "Trade Payables" },
  },
  {
    id: `${companyId}-e-${month}`,
    companyId,
    lineType: "equity",
    month,
    amount: -0.7 * assets,
    accountId: "acct-e",
    account: { code: "BS.02.01.01", name: "Share/Charter capital" },
  },
];

const readBS = async (companyId: string | null = null) => {
  const { collectSectionContext } = await import("./section-context");
  return (await collectSectionContext(
    "balance-sheet",
    "org_1",
    "plan_budget",
    companyId,
    null,
  )) as unknown as BSData;
};

describe("14.7 — the AI must see the same balance sheet the tab shows", () => {
  it("fault 1: reads the ACTUALS plan when the selected plan is a budget", async () => {
    // Budget plans carry no balance sheet — the client's workbook has
    // `BS Actual 2025` / `BS Actual 2026` and no budget BS tab at all. On
    // production `Azərşəkər 2026 Budget` has zero balance-sheet rows, so
    // reading planId literally handed the LLM an empty set and it reported
    // 0 AZN. The visible tab has always fallen back; this did not.
    budgetPlanFindFirst
      .mockResolvedValueOnce({
        id: "plan_budget",
        name: "Azərşəkər 2026 Budget",
        year: 2026,
        kind: "budget",
        periodType: "annual",
        status: "active",
      })
      .mockResolvedValueOnce({ id: "plan_actual", kind: "actual" });
    balanceSheetLineFindMany.mockResolvedValue(entityMonth("co_a", 5, 134_234_696));

    const data = await readBS();

    expect(balanceSheetLineFindMany.mock.calls[0][0].where.planId).toBe("plan_actual");
    expect(data.source.fellBackToActuals).toBe(true);
    // And it must SAY so — a fallback presented as the plan's own figures is
    // its own kind of wrong.
    expect(data.source.note).toMatch(/ACTUALS/);
    expect(data.totals.assets).toBe(134_234_696);
  });

  it("fault 2: reports the latest month with data, not a hardcoded December", async () => {
    // `if (r.month !== 12) continue`. The 2026 actuals run to May. Fixing the
    // fallback alone would still have produced zeros — and the bug would have
    // looked fixed on 2025, which has a December, and broken every January.
    balanceSheetLineFindMany.mockResolvedValue([
      ...entityMonth("co_a", 1, 129_044_387),
      ...entityMonth("co_a", 5, 134_234_696),
    ]);

    const data = await readBS();

    expect(data.totals.asOfMonth).toBe(5);
    expect(data.totals.assets).toBe(134_234_696);
    expect(data.source.asOfNote).toMatch(/month 5/);
    // Not a year-end position, and the payload has to say that out loud.
    expect(data.source.asOfNote).toMatch(/NOT a year-end/i);
  });

  it("fault 3: refuses to call four added-up entities a group balance sheet", async () => {
    // The worst of the three, because fixing only 1 and 2 turns a visible
    // zero into a confident 373,152,064 — the un-eliminated 2026-05 sum that
    // Defect 3 removed from the screen. The workbook's own INTRAGROUP
    // ELIMINATIONS block nets ~118M of intercompany holdings out of it.
    balanceSheetLineFindMany.mockResolvedValue([
      ...entityMonth("co_azsf", 5, 134_234_696),
      ...entityMonth("co_eden", 5, 177_351_645),
    ]);

    const data = await readBS();

    expect(data.basis.kind).toBe("sum_of_entities");
    expect(data.basis.entityCount).toBe(2);
    expect(data.basis.eliminationsApplied).toBe(false);
    expect(data.basis.note).toMatch(/eliminations/i);
    // The totals are still the best available number, so they are reported —
    // but leverage computed from double-counted equity is a different
    // quantity wearing a solvency metric's name.
    expect(data.totals.assets).toBe(311_586_341);
    expect(data.totals.debtToEquity).toBeNull();
  });

  it("prefers the holding's own consolidated rows over adding the children", async () => {
    companyFindMany.mockResolvedValue([{ id: "co_holding", name: "FO Holding" }]);
    balanceSheetLineCount.mockResolvedValue(42);
    balanceSheetLineFindMany.mockResolvedValue(entityMonth("co_holding", 12, 250_000_000));

    const data = await readBS();

    expect(balanceSheetLineFindMany.mock.calls[0][0].where.companyId).toBe("co_holding");
    expect(data.basis.kind).toBe("consolidated_holding");
    expect(data.basis.eliminationsApplied).toBe(true);
    // Eliminated by the client's own consolidation, so the ratio is real:
    // 30% liabilities over 70% equity.
    expect(data.totals.debtToEquity).toBeCloseTo(0.4286, 3);
  });

  it("normalizes the sign convention so the breakdown agrees with the totals", async () => {
    // Rows arrive with liabilities and equity negative. The old collector
    // returned equity verbatim, so the LLM read -315,545,630 and had every
    // reason to open with an equity-deficit warning about a solvent holding.
    balanceSheetLineFindMany.mockResolvedValue(entityMonth("co_a", 3, 1_000_000));

    const data = await readBS();

    expect(data.totals.liabilities).toBe(300_000);
    expect(data.totals.equity).toBe(700_000);
    expect(data.topLiabilities[0]).toEqual({ name: "Trade Payables", amount: 300_000 });
  });

  it("states an absent balance sheet as absent, never as zero", async () => {
    // The distinction the whole fix exists for: "nothing was loaded" and
    // "the assets are nil" are different sentences, and only one of them is
    // ever true here.
    balanceSheetLineFindMany.mockResolvedValue([]);

    const data = await readBS();

    expect(data.source.rowCount).toBe(0);
    expect(data.source.asOfMonth).toBeNull();
    expect(data.totals.assets).toBeNull();
    expect(data.totals.debtToEquity).toBeNull();
    expect(data.source.asOfNote).toMatch(/not been loaded/i);
  });
});
