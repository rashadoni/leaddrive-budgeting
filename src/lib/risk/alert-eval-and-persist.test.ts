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
    companyIndicator: { findMany: vi.fn() },
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
      status: 'active',
    },
  ]);
  prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([
    {
      id: 'ind_x',
      code: 'IND_GROSS_MARGIN',
      organizationId: null,
      industries: ['hospitality'],
      isActive: true,
    },
  ]);
  prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([]);
  prismaMock.companyIndicator.findMany.mockReset().mockResolvedValue([]);
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

  it('treats a pending onboarding shell as outside the alert decision surface', async () => {
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: 'co_pending',
        code: 'PENDING',
        name: 'Pending company',
        industry: 'hospitality',
        level: 2,
        isActive: true,
        role: 'operational',
        status: 'pending',
      },
    ]);
    prismaMock.alertEvent.deleteMany.mockResolvedValue({ count: 2 });

    const out = await evaluateAndPersistAlertsForPeriods(
      prismaMock as unknown as Parameters<
        typeof evaluateAndPersistAlertsForPeriods
      >[0],
      { organizationId: ORG_ID, periods: ['2026'] },
    );

    expect(prismaMock.indicatorValue.findMany).not.toHaveBeenCalled();
    expect(prismaMock.alertEvent.createMany).not.toHaveBeenCalled();
    expect(out).toMatchObject({ periodsPersisted: 1, totalDeleted: 2 });
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

  it('does not create alerts from an explicitly disabled matching pair', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { alertThresholds: { mostlyRed: { redCountMin: 1 } } },
    });
    prismaMock.companyIndicator.findMany.mockResolvedValue([
      { companyId: 'co_a', indicatorId: 'ind_x', enabled: false },
    ]);
    prismaMock.indicatorValue.findMany.mockResolvedValue([
      {
        companyId: 'co_a',
        indicatorId: 'ind_x',
        value: -10,
        status: 'red',
      },
    ]);

    await evaluateAndPersistAlertsForPeriods(
      prismaMock as unknown as Parameters<
        typeof evaluateAndPersistAlertsForPeriods
      >[0],
      { organizationId: ORG_ID, periods: ['2026'] },
    );

    expect(prismaMock.alertEvent.deleteMany).toHaveBeenCalledTimes(1);
    // 11.81 — the disabled pair still contributes NOTHING: no red-derived
    // alert exists. What the company does get is `company-low-coverage`,
    // which is the correct reading of "this entity has no usable data" and
    // is exactly the signal that used to be missing. Assert on the rule ids
    // rather than on createMany being untouched, so this test keeps testing
    // the disabled-pair contract instead of the alert count.
    const created = prismaMock.alertEvent.createMany.mock.calls.flatMap(
      (call) => (call[0] as { data: Array<{ ruleId: string }> }).data,
    );
    expect(created.map((e) => e.ruleId)).toEqual(['company-low-coverage']);
  });

  it('allows an explicitly enabled cross-industry pair to create alerts', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      settings: { alertThresholds: { mostlyRed: { redCountMin: 1 } } },
    });
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: 'co_a',
        code: 'AAA',
        name: 'A',
        industry: 'agriculture',
        level: 2,
        isActive: true,
        role: 'operational',
        status: 'active',
      },
    ]);
    prismaMock.companyIndicator.findMany.mockResolvedValue([
      { companyId: 'co_a', indicatorId: 'ind_x', enabled: true },
    ]);
    prismaMock.indicatorValue.findMany.mockResolvedValue([
      {
        companyId: 'co_a',
        indicatorId: 'ind_x',
        value: -10,
        status: 'red',
      },
    ]);
    prismaMock.alertEvent.createMany.mockResolvedValue({ count: 1 });

    const out = await evaluateAndPersistAlertsForPeriods(
      prismaMock as unknown as Parameters<
        typeof evaluateAndPersistAlertsForPeriods
      >[0],
      { organizationId: ORG_ID, periods: ['2026'] },
    );

    expect(prismaMock.alertEvent.createMany).toHaveBeenCalledTimes(1);
    expect(out.totalCreated).toBe(1);
  });

  it('evaluates only the org-scoped definition when its code overrides a global seed', async () => {
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: 'ind_global',
        code: 'IND_GROSS_MARGIN',
        organizationId: null,
        industries: ['hospitality'],
        isActive: true,
      },
      {
        id: 'ind_org',
        code: 'IND_GROSS_MARGIN',
        organizationId: ORG_ID,
        industries: ['hospitality'],
        isActive: true,
      },
    ]);

    await evaluateAndPersistAlertsForPeriods(
      prismaMock as unknown as Parameters<
        typeof evaluateAndPersistAlertsForPeriods
      >[0],
      { organizationId: ORG_ID, periods: ['2026'] },
    );

    expect(prismaMock.indicatorValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ indicatorId: { in: ['ind_org'] } }),
      }),
    );
  });

  it('does not evaluate hidden internal definitions on the operational leaf alert surface', async () => {
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: 'ind_internal',
        code: 'INTERNAL_HELPER',
        organizationId: null,
        industries: [],
        isActive: true,
        category: 'internal',
        requiredInputs: ['budgetLine'],
      },
    ]);

    await evaluateAndPersistAlertsForPeriods(
      prismaMock as unknown as Parameters<
        typeof evaluateAndPersistAlertsForPeriods
      >[0],
      { organizationId: ORG_ID, periods: ['2026'] },
    );

    expect(prismaMock.indicatorValue.findMany).not.toHaveBeenCalled();
    expect(prismaMock.alertEvent.createMany).not.toHaveBeenCalled();
    expect(prismaMock.alertEvent.deleteMany).toHaveBeenCalledTimes(1);
  });
});
