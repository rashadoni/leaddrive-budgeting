/**
 * Pure-function tests for period-snapshot hashing. Uses a mock Prisma
 * that returns canned IV + BudgetLine rows; verifies that:
 *   - identical inputs produce identical hashes (determinism),
 *   - changing one row mutates the hash,
 *   - aggregates match expected sums.
 */
import { describe, it, expect } from "vitest";
import { computePeriodHashes } from "./period-snapshot";

function makeMockPrisma(
  ivs: Array<{ companyId: string; indicatorId: string; value: number; status: string; period: string }>,
  lines: Array<{
    planId: string;
    companyId: string | null;
    accountId: string | null;
    monthIndex: number | null;
    plannedAmount: number;
    lineType: string;
    category: string;
  }>,
) {
  return {
    indicatorValue: { findMany: async () => ivs },
    budgetLine: { findMany: async () => lines },
  } as never;
}

describe("computePeriodHashes", () => {
  it("returns identical hashes for identical inputs", async () => {
    const ivs = [{ companyId: "c1", indicatorId: "i1", value: 100, status: "green", period: "2026" }];
    const lines = [
      { planId: "p1", companyId: "c1", accountId: "a1", monthIndex: 0, plannedAmount: 100, lineType: "revenue", category: "601" },
    ];
    const a = await computePeriodHashes(makeMockPrisma(ivs, lines), "org-1", "2026");
    const b = await computePeriodHashes(makeMockPrisma(ivs, lines), "org-1", "2026");
    expect(a.ivHash).toEqual(b.ivHash);
    expect(a.budgetHash).toEqual(b.budgetHash);
  });

  it("changes ivHash when an IV value is mutated", async () => {
    const ivs1 = [{ companyId: "c1", indicatorId: "i1", value: 100, status: "green", period: "2026" }];
    const ivs2 = [{ companyId: "c1", indicatorId: "i1", value: 101, status: "green", period: "2026" }];
    const lines = [
      { planId: "p1", companyId: "c1", accountId: "a1", monthIndex: 0, plannedAmount: 100, lineType: "revenue", category: "601" },
    ];
    const a = await computePeriodHashes(makeMockPrisma(ivs1, lines), "org-1", "2026");
    const b = await computePeriodHashes(makeMockPrisma(ivs2, lines), "org-1", "2026");
    expect(a.ivHash).not.toEqual(b.ivHash);
    // BudgetLine unchanged.
    expect(a.budgetHash).toEqual(b.budgetHash);
  });

  it("aggregates revenue/cogs/grossProfit correctly", async () => {
    const lines = [
      { planId: "p1", companyId: "c1", accountId: "a1", monthIndex: 0, plannedAmount: 50, lineType: "revenue", category: "601" },
      { planId: "p1", companyId: "c1", accountId: "a1", monthIndex: 1, plannedAmount: 30, lineType: "revenue", category: "601" },
      { planId: "p1", companyId: "c1", accountId: "a2", monthIndex: 0, plannedAmount: -20, lineType: "cogs", category: "701" },
    ];
    const r = await computePeriodHashes(makeMockPrisma([], lines), "org-1", "2026");
    expect(r.aggregates.revenueTotal).toBe(80);
    expect(r.aggregates.cogsTotal).toBe(20); // Math.abs(-20)
    expect(r.aggregates.grossProfit).toBe(60);
    expect(r.aggregates.budgetLineCount).toBe(3);
  });

  it("is stable to row ordering (sort canonicalization)", async () => {
    const linesA = [
      { planId: "p1", companyId: "c1", accountId: "a1", monthIndex: 0, plannedAmount: 50, lineType: "revenue", category: "601" },
      { planId: "p1", companyId: "c2", accountId: "a2", monthIndex: 1, plannedAmount: 30, lineType: "revenue", category: "601" },
    ];
    const linesB = [...linesA].reverse();
    const a = await computePeriodHashes(makeMockPrisma([], linesA), "org-1", "2026");
    const b = await computePeriodHashes(makeMockPrisma([], linesB), "org-1", "2026");
    expect(a.budgetHash).toEqual(b.budgetHash);
  });
});
