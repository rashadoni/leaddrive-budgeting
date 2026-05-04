// @vitest-environment node
/**
 * Phase 7.E C6 v3 (Turn III) — persistAlertEvents helper.
 *
 * Locks: (a) deleteMany scoped to the same `(orgId, period)` runs first;
 * (b) createMany receives a row per match with the right shape; (c)
 * both calls execute inside `prisma.$transaction`; (d) empty matches
 * still wipes the prior period's rows but skips createMany; (e) the
 * affected*Ids arrays are defensively cloned (helper output not aliased
 * to caller input) and `affectedIndicatorCodes` defaults to `[]` when
 * the AlertMatch omits it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AlertMatch } from './alert-rules';

import { persistAlertEvents } from './alert-events';

interface TxClient {
  alertEvent: {
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
}

interface PrismaMock {
  $transaction: ReturnType<typeof vi.fn>;
  alertEvent: {
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
}

let prisma: PrismaMock;
let tx: TxClient;

beforeEach(() => {
  tx = {
    alertEvent: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  prisma = {
    alertEvent: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: TxClient) => Promise<unknown>) => {
      return cb(tx);
    }),
  };
});

const ORG_ID = 'org_demo';
const PERIOD = '2025';

function match(overrides: Partial<AlertMatch> = {}): AlertMatch {
  return {
    ruleId: 'RULE_X',
    ruleName: 'Rule X',
    severity: 'warning',
    message: 'AAC: 3 reds',
    messageKey: 'alerts.messages.RULE_X',
    messageParams: { code: 'AAC', count: 3 },
    affectedCompanyIds: ['co_a'],
    affectedIndicatorCodes: ['IND_GROSS_MARGIN'],
    ...overrides,
  };
}

describe('persistAlertEvents', () => {
  it('runs deleteMany + createMany inside one transaction', async () => {
    const matches = [match()];
    tx.alertEvent.deleteMany.mockResolvedValue({ count: 4 });
    tx.alertEvent.createMany.mockResolvedValue({ count: 1 });

    const result = await persistAlertEvents(
      prisma as unknown as Parameters<typeof persistAlertEvents>[0],
      { organizationId: ORG_ID, period: PERIOD, matches },
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.alertEvent.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, period: PERIOD },
    });
    expect(tx.alertEvent.createMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ deleted: 4, created: 1 });
  });

  it('createMany receives one row per match with the right shape', async () => {
    const matches: AlertMatch[] = [
      match({
        ruleId: 'RULE_CRITICAL_INDICATOR',
        severity: 'critical',
        affectedCompanyIds: ['co_a', 'co_b'],
        affectedIndicatorCodes: ['IND_NET_MARGIN'],
        messageParams: { code: 'IND_NET_MARGIN', threshold: 3 },
      }),
      match({
        ruleId: 'RULE_SECTOR_AMBER_CLUSTER',
        severity: 'info',
        affectedCompanyIds: ['co_c'],
        affectedIndicatorCodes: undefined,
      }),
    ];
    tx.alertEvent.deleteMany.mockResolvedValue({ count: 0 });
    tx.alertEvent.createMany.mockResolvedValue({ count: 2 });

    await persistAlertEvents(
      prisma as unknown as Parameters<typeof persistAlertEvents>[0],
      { organizationId: ORG_ID, period: PERIOD, matches },
    );

    const call = tx.alertEvent.createMany.mock.calls[0]?.[0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(call.data).toHaveLength(2);
    expect(call.data[0]).toMatchObject({
      organizationId: ORG_ID,
      period: PERIOD,
      ruleId: 'RULE_CRITICAL_INDICATOR',
      severity: 'critical',
      affectedCompanyIds: ['co_a', 'co_b'],
      affectedIndicatorCodes: ['IND_NET_MARGIN'],
    });
    // Default empty array when match has no affectedIndicatorCodes.
    expect(call.data[1].affectedIndicatorCodes).toEqual([]);
  });

  it('empty matches still wipes prior period rows but skips createMany', async () => {
    tx.alertEvent.deleteMany.mockResolvedValue({ count: 7 });

    const result = await persistAlertEvents(
      prisma as unknown as Parameters<typeof persistAlertEvents>[0],
      { organizationId: ORG_ID, period: PERIOD, matches: [] },
    );

    expect(tx.alertEvent.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.alertEvent.createMany).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 7, created: 0 });
  });

  it('defensively clones affectedCompanyIds (no caller-aliasing)', async () => {
    const sourceIds: string[] = ['co_a'];
    tx.alertEvent.deleteMany.mockResolvedValue({ count: 0 });
    tx.alertEvent.createMany.mockResolvedValue({ count: 1 });

    await persistAlertEvents(
      prisma as unknown as Parameters<typeof persistAlertEvents>[0],
      {
        organizationId: ORG_ID,
        period: PERIOD,
        matches: [match({ affectedCompanyIds: sourceIds })],
      },
    );

    const call = tx.alertEvent.createMany.mock.calls[0]?.[0] as {
      data: Array<{ affectedCompanyIds: string[] }>;
    };
    expect(call.data[0].affectedCompanyIds).toEqual(['co_a']);
    expect(call.data[0].affectedCompanyIds).not.toBe(sourceIds);
  });

  it('passes through messageParams as-is to JSON column', async () => {
    const params = {
      industry: 'industrial',
      indicatorCode: 'IND_NET_MARGIN',
      count: 5,
    };
    tx.alertEvent.deleteMany.mockResolvedValue({ count: 0 });
    tx.alertEvent.createMany.mockResolvedValue({ count: 1 });

    await persistAlertEvents(
      prisma as unknown as Parameters<typeof persistAlertEvents>[0],
      {
        organizationId: ORG_ID,
        period: PERIOD,
        matches: [match({ messageParams: params })],
      },
    );

    const call = tx.alertEvent.createMany.mock.calls[0]?.[0] as {
      data: Array<{ messageParams: unknown }>;
    };
    expect(call.data[0].messageParams).toEqual(params);
  });
});
