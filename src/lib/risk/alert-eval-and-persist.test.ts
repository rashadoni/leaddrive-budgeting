// @vitest-environment node
/**
 * Phase 7.E C6 v3.1 (Turn IV) — evaluateAndPersistAlertsForPeriods.
 *
 * Composed pipeline test: org settings → operational filter → IV fetch →
 * `evaluateAlertRules` → `persistAlertEvents`. Locks: empty-periods no-op,
 * empty-org-graph still wipes prior state, multi-period iteration, error
 * isolation per period (one bad period doesn't stop the others).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    organization: { findUnique: vi.fn() },
    company: { findMany: vi.fn() },
    indicatorDefinition: { findMany: vi.fn() },
    indicatorValue: { findMany: vi.fn() },
    alertEvent: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { evaluateAndPersistAlertsForPeriods } from './alert-eval-and-persist';

const ORG_ID = 'org_demo';

beforeEach(() => {
  prismaMock.organization.findUnique
    .mockReset()
    .mockResolvedValue({ settings: null });
  prismaMock.company.findMany.mockReset().mockResolvedValue([
    {
      id: 'co_a',
      code: 'AAA',
      name: 'A',
      industry: 'hospitality',
      level: 2,
      isActive: true,
      role: 'operational',
    },
  ]);
  prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([
    { id: 'ind_x', code: 'IND_GROSS_MARGIN' },
  ]);
  prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([]);
  // $transaction proxies callback-style usage so persistAlertEvents runs
  // its tx body normally; alertEvent.deleteMany/createMany live on the
  // outer mock (same object passed in).
  prismaMock.$transaction.mockReset().mockImplementation(
    async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock),
  );
  prismaMock.alertEvent.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  prismaMock.alertEvent.createMany.mockReset().mockResolvedValue({ count: 0 });
});

describe('evaluateAndPersistAlertsForPeriods', () => {
  it('empty periods is a no-op (no DB hit)', async () => {
    const out = await evaluateAndPersistAlertsForPeriods(
      prismaMock as unknown as Parameters<
        typeof evaluateAndPersistAlertsForPeriods
      >[0],
      { organizationId: ORG_ID, periods: [] },
    );
    expect(out).toEqual({
      periodsPersisted: 0,
      totalCreated: 0,
      totalDeleted: 0,
      failed: 0,
    });
    expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.company.findMany).not.toHaveBeenCalled();
  });

  it('persists empty matches per period when org has no operational cos', async () => {
    prismaMock.company.findMany.mockResolvedValue([]); // no operational cos
    prismaMock.alertEvent.deleteMany.mockResolvedValue({ count: 7 });

    const out = await evaluateAndPersistAlertsForPeriods(
      prismaMock as unknown as Parameters<
        typeof evaluateAndPersistAlertsForPeriods
      >[0],
      { organizationId: ORG_ID, periods: ['2025'] },
    );

    expect(prismaMock.alertEvent.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.alertEvent.createMany).not.toHaveBeenCalled();
    expect(out).toEqual({
      periodsPersisted: 1,
      totalCreated: 0,
      totalDeleted: 7,
      failed: 0,
    });
  });

  it('iterates periods + persist runs once per period', async () => {
    prismaMock.indicatorValue.findMany.mockResolvedValue([
      {
        companyId: 'co_a',
        indicatorId: 'ind_x',
        value: 65,
        status: 'green',
      },
    ]);

    const out = await evaluateAndPersistAlertsForPeriods(
      prismaMock as unknown as Parameters<
        typeof evaluateAndPersistAlertsForPeriods
      >[0],
      { organizationId: ORG_ID, periods: ['2025', '2026'] },
    );

    // IV fetch hits once per period.
    expect(prismaMock.indicatorValue.findMany).toHaveBeenCalledTimes(2);
    // deleteMany scoped per (org, period) — 2 calls, distinct period args.
    expect(prismaMock.alertEvent.deleteMany).toHaveBeenCalledTimes(2);
    const dmCalls = prismaMock.alertEvent.deleteMany.mock.calls;
    expect(dmCalls[0]?.[0]).toEqual({
      where: { organizationId: ORG_ID, period: '2025' },
    });
    expect(dmCalls[1]?.[0]).toEqual({
      where: { organizationId: ORG_ID, period: '2026' },
    });
    expect(out.periodsPersisted).toBe(2);
    expect(out.failed).toBe(0);
  });

  it('isolates per-period failures (one bad period does not halt the others)', async () => {
    prismaMock.indicatorValue.findMany
      .mockResolvedValueOnce([]) // 2025 ok
      .mockRejectedValueOnce(new Error('Postgres temporary failure')) // 2026 throws
      .mockResolvedValueOnce([]); // 2027 ok

    const periodErrors: Array<{ period: string; msg: string }> = [];
    const out = await evaluateAndPersistAlertsForPeriods(
      prismaMock as unknown as Parameters<
        typeof evaluateAndPersistAlertsForPeriods
      >[0],
      { organizationId: ORG_ID, periods: ['2025', '2026', '2027'] },
      {
        periodError: (period, err) =>
          periodErrors.push({
            period,
            msg: (err as Error).message,
          }),
      },
    );

    expect(out.periodsPersisted).toBe(2);
    expect(out.failed).toBe(1);
    expect(periodErrors).toHaveLength(1);
    expect(periodErrors[0]).toEqual({
      period: '2026',
      msg: 'Postgres temporary failure',
    });
  });

  it('reads alert thresholds from Organization.settings', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { alertThresholds: { mostlyRed: { redCount: 7 } } },
    });
    prismaMock.indicatorValue.findMany.mockResolvedValue([]);

    await evaluateAndPersistAlertsForPeriods(
      prismaMock as unknown as Parameters<
        typeof evaluateAndPersistAlertsForPeriods
      >[0],
      { organizationId: ORG_ID, periods: ['2025'] },
    );

    expect(prismaMock.organization.findUnique).toHaveBeenCalledWith({
      where: { id: ORG_ID },
      select: { settings: true },
    });
  });
});
