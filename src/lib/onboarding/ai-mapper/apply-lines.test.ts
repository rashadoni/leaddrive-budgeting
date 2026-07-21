/**
 * Phase C slice C2.3 — shared per-company write primitive tests.
 *
 * The corruption-critical assertion (Codex 2026-06-20): the clean-slate
 * deleteMany WHERE is EXACTLY `(organizationId, planId, companyId)` — never
 * broader. Plus the 12-row monthly fan-out contract (mirrors the single-route
 * inner-callback test).
 */
import { describe, it, expect, vi } from 'vitest';
import { applyParsedLinesToCompany } from './apply-lines';
import type { ParsedBudgetLine } from '../adapters/azmade-sopl';

function txSpy() {
  const budgetLineCreates: Array<Record<string, unknown>> = [];
  const deleteWheres: Array<unknown> = [];
  const tx = {
    budgetLine: {
      deleteMany: vi.fn(async ({ where }: { where: unknown }) => {
        deleteWheres.push(where);
        return { count: 7 };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        budgetLineCreates.push(data);
        return { id: `bl-${budgetLineCreates.length}` };
      }),
    },
    chartOfAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `coa-${data.code}` })),
    },
  };
  return { tx, budgetLineCreates, deleteWheres };
}

const lines: ParsedBudgetLine[] = [
  { code: 'PLF.01.01', label: 'Sales', accountType: 'revenue', plannedAnnual: 120, perMonth: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10] },
  { code: 'PLF.02.01', label: 'Cost', accountType: 'cogs', plannedAnnual: 60, perMonth: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5] },
];

describe('applyParsedLinesToCompany', () => {
  it('clean-slate deletes scoped EXACTLY to (org, plan, company) — never broader', async () => {
    const { tx, deleteWheres } = txSpy();
    await applyParsedLinesToCompany(tx as never, {
      organizationId: 'org1',
      planId: 'plan1',
      companyId: 'coA',
      lines,
      baseCurrencyCode: 'AZN',
    });
    expect(deleteWheres).toHaveLength(1);
    expect(deleteWheres[0]).toEqual({ organizationId: 'org1', planId: 'plan1', companyId: 'coA' });
  });

  it('writes 12 rows per line at sortOrder=monthIndex with the company base currency', async () => {
    const { tx, budgetLineCreates } = txSpy();
    const res = await applyParsedLinesToCompany(tx as never, {
      organizationId: 'org1',
      planId: 'plan1',
      companyId: 'coA',
      lines,
      baseCurrencyCode: 'USD',
    });
    expect(budgetLineCreates).toHaveLength(24); // 2 lines × 12
    expect(res).toEqual({ inserted: 2, deleted: 7 });

    const revRows = budgetLineCreates.filter((d) => d.accountId === 'coa-PLF.01.01');
    expect(revRows).toHaveLength(12);
    expect(revRows.map((r) => r.sortOrder).sort((a, b) => (a as number) - (b as number))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    revRows.forEach((r) => {
      expect(r.companyId).toBe('coA');
      expect(r.planId).toBe('plan1');
      expect(r.organizationId).toBe('org1');
      expect(r.lineType).toBe('revenue');
      expect(r.isAutoPlanned).toBe(false);
      expect(r.currencyCode).toBe('USD');
    });
    const cogsRows = budgetLineCreates.filter((d) => d.accountId === 'coa-PLF.02.01');
    cogsRows.forEach((r) => expect(r.lineType).toBe('cogs'));
  });

  it('caches CoA lookups — one findUnique per distinct code, not per row', async () => {
    const { tx, deleteWheres } = txSpy();
    await applyParsedLinesToCompany(tx as never, {
      organizationId: 'org1',
      planId: 'plan1',
      companyId: 'coA',
      lines,
      baseCurrencyCode: 'AZN',
    });
    expect(tx.chartOfAccount.findUnique).toHaveBeenCalledTimes(2); // 2 distinct codes
  });

  it('persists proven foreign source amounts separately from base amounts', async () => {
    const { tx, budgetLineCreates } = txSpy();
    const foreign: ParsedBudgetLine[] = [{
      code: '601-01', label: 'Export', accountType: 'revenue', plannedAnnual: 2040,
      perMonth: Array(12).fill(170),
      currencyEvidence: {
        currencyCode: 'USD', exchangeRate: 1.7, originalPerMonth: Array(12).fill(100),
      },
    }];
    await applyParsedLinesToCompany(tx as never, {
      organizationId: 'org1', planId: 'plan1', companyId: 'coA', lines: foreign, baseCurrencyCode: 'AZN',
    });
    expect(budgetLineCreates[0]).toMatchObject({
      plannedAmount: 170, originalAmount: 100, currencyCode: 'USD', exchangeRate: 1.7,
    });
  });

  it('fails closed for a foreign sheet tag without source/rate evidence', async () => {
    const { tx, deleteWheres } = txSpy();
    await expect(applyParsedLinesToCompany(tx as never, {
      organizationId: 'org1', planId: 'plan1', companyId: 'coA', lines,
      baseCurrencyCode: 'AZN', defaultCurrencyCode: 'USD',
    })).rejects.toThrow(/source amount/i);
    expect(deleteWheres).toHaveLength(0);
  });
});
