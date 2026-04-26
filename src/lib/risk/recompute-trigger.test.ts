/**
 * Tests for `recompute-trigger.ts` — orchestration layer extracted from
 * three near-identical inline copies (budget endpoint, staging apply,
 * batch CLI script). Mocks `recompute.ts` to avoid spinning up the full
 * formula pipeline; passes a hand-rolled fake PrismaClient that returns
 * canned company + indicator-definition rows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./recompute', () => ({
  createPrismaDataSource: vi.fn(() => ({ __mock: 'datasource' })),
  recomputeIndicator: vi.fn(),
}));

import { runRecomputeForCompanies } from './recompute-trigger';
import { recomputeIndicator } from './recompute';

const mockedRecompute = vi.mocked(recomputeIndicator);

type Company = {
  id: string;
  code: string;
  industry: string | null;
  level: number | null;
  isActive: boolean;
  role: 'operational' | 'admin' | 'holding';
};

type IndicatorDefRow = {
  id: string;
  organizationId: string | null;
  code: string;
  formula: string;
  thresholds: unknown;
  requiredInputs: string[];
  industries: string[];
  isActive: boolean;
  unit: string | null;
};

function makePrisma(
  companies: Company[],
  indicators: IndicatorDefRow[],
): {
  company: { findMany: ReturnType<typeof vi.fn> };
  indicatorDefinition: { findMany: ReturnType<typeof vi.fn> };
} {
  return {
    company: { findMany: vi.fn().mockResolvedValue(companies) },
    indicatorDefinition: { findMany: vi.fn().mockResolvedValue(indicators) },
  };
}

function ind(overrides: Partial<IndicatorDefRow> = {}): IndicatorDefRow {
  return {
    id: 'i1',
    organizationId: null,
    code: 'HOSP_OCC',
    formula: 'rooms_sold / rooms_available * 100',
    thresholds: { green: { op: '>=', value: 70 } },
    requiredInputs: ['booking', 'company.settings.totalRooms'],
    industries: ['hospitality'],
    isActive: true,
    unit: '%',
    ...overrides,
  };
}

function co(overrides: Partial<Company> = {}): Company {
  return {
    id: 'co_1',
    code: 'HLTN',
    industry: 'hospitality',
    level: 2,
    isActive: true,
    role: 'operational',
    ...overrides,
  };
}

beforeEach(() => {
  mockedRecompute.mockReset();
});

describe('runRecomputeForCompanies', () => {
  it('returns empty result for empty affected list (no DB hit)', async () => {
    const prisma = makePrisma([co()], [ind()]);
    const result = await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [],
    );
    expect(result).toEqual({ ok: 0, unknown: 0, failed: 0, targets: 0 });
    expect(prisma.company.findMany).not.toHaveBeenCalled();
    expect(prisma.indicatorDefinition.findMany).not.toHaveBeenCalled();
  });

  it('single-company single-year: degenerates batch loop to one pair', async () => {
    const prisma = makePrisma([co()], [ind()]);
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

    const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
    ]);

    expect(result).toEqual({ ok: 1, unknown: 0, failed: 0, targets: 1 });
    expect(mockedRecompute).toHaveBeenCalledTimes(1);
    expect(mockedRecompute).toHaveBeenCalledWith(
      { __mock: 'datasource' },
      expect.objectContaining({
        organizationId: 'org_1',
        companyId: 'co_1',
        period: '2026',
      }),
    );
  });

  it('skips admin / holding cost-centres before fetching indicators', async () => {
    const prisma = makePrisma(
      [
        co({ id: 'co_1', code: 'HQ', role: 'admin' }),
        co({ id: 'co_2', code: 'TOP', role: 'holding' }),
      ],
      [ind()],
    );
    const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
      { companyId: 'co_2', year: 2026 },
    ]);
    expect(result).toEqual({ ok: 0, unknown: 0, failed: 0, targets: 0 });
    expect(prisma.indicatorDefinition.findMany).not.toHaveBeenCalled();
    expect(mockedRecompute).not.toHaveBeenCalled();
  });

  it('counts unknown vs ok separately', async () => {
    const prisma = makePrisma([co()], [
      ind({ id: 'i1', code: 'A' }),
      ind({ id: 'i2', code: 'B' }),
    ]);
    mockedRecompute
      .mockResolvedValueOnce({ ok: true, status: 'green', value: 75 })
      .mockResolvedValueOnce({ ok: true, status: 'unknown', value: 0 });
    const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
    ]);
    expect(result).toEqual({ ok: 1, unknown: 1, failed: 0, targets: 2 });
  });

  it('catches per-pair errors and increments `failed` (does not throw)', async () => {
    const prisma = makePrisma([co()], [
      ind({ id: 'i1', code: 'OK' }),
      ind({ id: 'i2', code: 'BAD' }),
    ]);
    mockedRecompute
      .mockResolvedValueOnce({ ok: true, status: 'green', value: 75 })
      .mockRejectedValueOnce(new Error('boom'));
    const errors: Array<[string, unknown]> = [];
    const result = await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [{ companyId: 'co_1', year: 2026 }],
      { pairError: (label, err) => errors.push([label, err]) },
    );
    expect(result).toEqual({ ok: 1, unknown: 0, failed: 1, targets: 2 });
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe('HLTN/BAD [2026]');
  });

  it('multi-year batch: a 2025-only company is recomputed under period="2025", not 2026', async () => {
    const prisma = makePrisma(
      [co({ id: 'co_1', code: 'A' }), co({ id: 'co_2', code: 'B' })],
      [ind()],
    );
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });

    await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2025 },
      { companyId: 'co_2', year: 2026 },
    ]);

    const calls = mockedRecompute.mock.calls.map((c) => ({
      companyId: c[1].companyId,
      period: c[1].period,
    }));
    expect(calls).toEqual([
      { companyId: 'co_1', period: '2025' },
      { companyId: 'co_2', period: '2026' },
    ]);
  });

  it('sector-agnostic indicators (industries=[]) match every operational company', async () => {
    const prisma = makePrisma(
      [
        co({ id: 'co_1', code: 'A', industry: 'hospitality' }),
        co({ id: 'co_2', code: 'B', industry: 'agro_crops' }),
      ],
      [ind({ id: 'fx', code: 'FX_IMPORTED_INPUT', industries: [] })],
    );
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 50 });

    const result = await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
      { companyId: 'co_2', year: 2026 },
    ]);
    expect(result.targets).toBe(2);
    expect(mockedRecompute).toHaveBeenCalledTimes(2);
  });

  it('prefers org-scoped indicator over global with same code (Phase 7.A.0 contract)', async () => {
    const prisma = makePrisma(
      [co()],
      [
        ind({ id: 'global', organizationId: null, code: 'DUP', formula: 'g' }),
        ind({ id: 'org', organizationId: 'org_1', code: 'DUP', formula: 'o' }),
      ],
    );
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 1 });

    await runRecomputeForCompanies(prisma as never, 'org_1', [
      { companyId: 'co_1', year: 2026 },
    ]);

    expect(mockedRecompute).toHaveBeenCalledTimes(1);
    expect(mockedRecompute.mock.calls[0][1].definition.id).toBe('org');
  });

  it('logger callbacks fire on the expected paths', async () => {
    const prisma = makePrisma([co()], [ind()]);
    mockedRecompute.mockResolvedValue({ ok: true, status: 'green', value: 75 });
    const log: string[] = [];
    await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [{ companyId: 'co_1', year: 2026 }],
      {
        start: (m) => log.push(`start:${m}`),
        done: (m) => log.push(`done:${m}`),
        noop: (m) => log.push(`noop:${m}`),
      },
    );
    expect(log.some((l) => l.startsWith('start:'))).toBe(true);
    expect(log.some((l) => l.startsWith('done:'))).toBe(true);
    expect(log.some((l) => l.startsWith('noop:'))).toBe(false);
  });

  it('logger noop fires when no operational companies are in the affected set', async () => {
    const prisma = makePrisma(
      [co({ id: 'co_1', role: 'admin' })],
      [ind()],
    );
    const noops: string[] = [];
    await runRecomputeForCompanies(
      prisma as never,
      'org_1',
      [{ companyId: 'co_1', year: 2026 }],
      { noop: (m) => noops.push(m) },
    );
    expect(noops).toHaveLength(1);
    expect(noops[0]).toMatch(/no operational/i);
  });
});
