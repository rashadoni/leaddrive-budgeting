/**
 * Smoke tests for the onboarding completeness checker. Uses an in-memory
 * mock Prisma that returns the counts each test sets up — covers the
 * happy path + each section's "missing" / "partial" / "complete" branch
 * without hitting Postgres.
 */
import { describe, it, expect } from "vitest";
import { checkOnboardingCompleteness } from "./completeness-checker";

type CountFn = () => Promise<number>;

interface MockCounts {
  coa?: number;
  revenueLines?: number;
  cogsLines?: number;
  expenseLines?: number;
  salesBudget?: number;
  cogsBudget?: number;
  balanceSheet?: number;
  cashFlow?: number;
  actuals?: number;
  assumptions?: number;
  esg?: number;
}

function makeMockPrisma(
  company: {
    id: string;
    code: string;
    industry: string | null;
    settings: Record<string, unknown>;
  },
  counts: MockCounts,
) {
  const c = (key: keyof MockCounts): CountFn => async () => counts[key] ?? 0;
  return {
    company: {
      findUnique: async () => ({
        id: company.id,
        code: company.code,
        industry: company.industry,
        settings: company.settings,
        organizationId: "org-1",
      }),
    },
    chartOfAccount: { count: c("coa") },
    budgetLine: {
      count: async ({ where }: { where: { lineType?: string } }) => {
        if (where.lineType === "revenue") return counts.revenueLines ?? 0;
        if (where.lineType === "cogs") return counts.cogsLines ?? 0;
        if (where.lineType === "expense") return counts.expenseLines ?? 0;
        return 0;
      },
      // Used to derive plan ids belonging to this company. Return a
      // single fake plan when the company has any P&L rows so the
      // plan-scoped section queries below resolve to non-zero.
      findMany: async () => {
        const hasAnyPnl = (counts.revenueLines ?? 0) + (counts.cogsLines ?? 0) > 0;
        return hasAnyPnl ? [{ planId: "plan-1" }] : [];
      },
    },
    salesBudgetLine: { count: c("salesBudget") },
    cOGSBudgetLine: { count: c("cogsBudget") },
    balanceSheetLine: { count: c("balanceSheet") },
    cashFlowEntry: { count: c("cashFlow") },
    budgetActual: { count: c("actuals") },
    budgetAssumption: { count: c("assumptions") },
    indicatorValue: { count: c("esg") },
    // satisfy the PrismaClient typing
  } as never;
}

describe("checkOnboardingCompleteness", () => {
  const baseCompany = {
    id: "co-1",
    code: "TEST-CO",
    industry: "agro_crops",
    settings: { hectaresPlanted: 100, region: "Salyan", cropType: "sugarcane" },
  };

  it("returns 100% when every section is satisfied", async () => {
    const prisma = makeMockPrisma(baseCompany, {
      coa: 50,
      revenueLines: 12,
      cogsLines: 12,
      expenseLines: 12,
      salesBudget: 24,
      cogsBudget: 24,
      balanceSheet: 12,
      cashFlow: 12,
      actuals: 36,
      assumptions: 6,
      esg: 4,
    });
    const r = await checkOnboardingCompleteness(prisma, "co-1", "2026");
    expect(r.overall).toBe("verified");
    expect(r.percentComplete).toBe(100);
    expect(r.sections.find((s) => s.code === "§1")?.status).toBe("complete");
    expect(r.sections.find((s) => s.code === "§R.1")?.status).toBe("complete");
  });

  it("marks P&L as missing when no revenue lines exist", async () => {
    const prisma = makeMockPrisma(baseCompany, {
      coa: 50,
      revenueLines: 0,
      cogsLines: 0,
      salesBudget: 1,
      assumptions: 1,
    });
    const r = await checkOnboardingCompleteness(prisma, "co-1", "2026");
    expect(r.sections.find((s) => s.code === "§2")?.status).toBe("missing");
    // Blocking section missing → overall pending.
    expect(r.overall).toBe("pending");
  });

  it("flags partial P&L when revenue loaded but COGS missing", async () => {
    const prisma = makeMockPrisma(baseCompany, {
      coa: 50,
      revenueLines: 12,
      cogsLines: 0,
      expenseLines: 6,
    });
    const r = await checkOnboardingCompleteness(prisma, "co-1", "2026");
    const pnl = r.sections.find((s) => s.code === "§2");
    expect(pnl?.status).toBe("partial");
    expect(pnl?.hint).toMatch(/no COGS/i);
  });

  it("marks industry settings missing when keys absent", async () => {
    const prisma = makeMockPrisma(
      { ...baseCompany, settings: {} },
      { coa: 50, revenueLines: 1 },
    );
    const r = await checkOnboardingCompleteness(prisma, "co-1", "2026");
    expect(r.sections.find((s) => s.code === "§R.1")?.status).toBe("missing");
  });

  it("returns industry section as n_a when industry is null", async () => {
    const prisma = makeMockPrisma(
      { ...baseCompany, industry: null },
      { coa: 50, revenueLines: 1 },
    );
    const r = await checkOnboardingCompleteness(prisma, "co-1", "2026");
    // industry null is treated as a missing blocking section (§0.6).
    expect(r.sections.find((s) => s.code === "§0.6")?.status).toBe("missing");
    expect(r.overall).toBe("pending");
  });

  it("flags ESG as partial when only some Scope IVs exist", async () => {
    const prisma = makeMockPrisma(baseCompany, {
      coa: 50,
      revenueLines: 12,
      cogsLines: 12,
      esg: 1,
    });
    const r = await checkOnboardingCompleteness(prisma, "co-1", "2026");
    expect(r.sections.find((s) => s.code === "§R.0")?.status).toBe("partial");
  });

  it("excludes n_a sections from the % denominator", async () => {
    const prisma = makeMockPrisma(
      { ...baseCompany, industry: "retail" }, // no specific section defined → n_a
      {
        coa: 50,
        revenueLines: 12,
        cogsLines: 12,
        salesBudget: 1,
        cogsBudget: 1,
        balanceSheet: 1,
        cashFlow: 1,
        actuals: 1,
        assumptions: 1,
        esg: 4,
      },
    );
    const r = await checkOnboardingCompleteness(prisma, "co-1", "2026");
    // retail isn't in the requirements map → industry section is n_a; not
    // counted in denominator → percent stays 100%.
    expect(r.percentComplete).toBe(100);
    expect(r.overall).toBe("verified");
  });
});
