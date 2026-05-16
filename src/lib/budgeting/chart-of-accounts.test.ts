/**
 * Phase 2.1 step 2 — chart-of-accounts helper unit tests.
 *
 * Locks the SAP-code regex + the look-up contract (returns id when row
 * exists, null on no-match or non-code category). Pure-function gate
 * so the lines/POST handler test can rely on `accountId` being whatever
 * `resolveAccountId` returns without re-asserting Prisma plumbing.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  looksLikeAccountCode,
  resolveAccountId,
} from './chart-of-accounts';

describe('looksLikeAccountCode', () => {
  it('matches 3-digit root codes', () => {
    expect(looksLikeAccountCode('601')).toBe(true);
    expect(looksLikeAccountCode('711')).toBe(true);
    expect(looksLikeAccountCode('800')).toBe(true);
  });

  it('matches multi-segment codes', () => {
    expect(looksLikeAccountCode('601-01')).toBe(true);
    expect(looksLikeAccountCode('601-01-02')).toBe(true);
    expect(looksLikeAccountCode('801-99-99-99')).toBe(true);
  });

  it('rejects free-text categories', () => {
    expect(looksLikeAccountCode('Sales — Hospitality')).toBe(false);
    expect(looksLikeAccountCode('Cost of Goods Sold')).toBe(false);
    expect(looksLikeAccountCode('Маркетинг')).toBe(false);
    expect(looksLikeAccountCode('Xidmət gəlirləri')).toBe(false);
  });

  it('rejects partial / malformed codes', () => {
    expect(looksLikeAccountCode('60')).toBe(false); // <3 digits
    expect(looksLikeAccountCode('6011')).toBe(false); // 4-digit root not allowed
    expect(looksLikeAccountCode('601-')).toBe(false); // trailing dash
    expect(looksLikeAccountCode('-601')).toBe(false); // leading dash
    expect(looksLikeAccountCode('601-AB')).toBe(false); // non-digit segment
    expect(looksLikeAccountCode('')).toBe(false);
    expect(looksLikeAccountCode('   ')).toBe(false);
  });
});

describe('resolveAccountId', () => {
  function makeMock(returnedId: string | null) {
    return {
      chartOfAccount: {
        findUnique: vi.fn().mockResolvedValue(
          returnedId ? { id: returnedId } : null,
        ),
      },
    };
  }

  it('returns null for free-text category WITHOUT touching DB', async () => {
    const mock = makeMock('coa_should_not_appear');
    const result = await resolveAccountId(mock, 'org_1', 'Sales — Hospitality');
    expect(result).toBeNull();
    expect(mock.chartOfAccount.findUnique).not.toHaveBeenCalled();
  });

  it('returns null for empty string WITHOUT touching DB', async () => {
    const mock = makeMock('coa_unused');
    const result = await resolveAccountId(mock, 'org_1', '');
    expect(result).toBeNull();
    expect(mock.chartOfAccount.findUnique).not.toHaveBeenCalled();
  });

  it('returns id when SAP code matches an existing ChartOfAccount row', async () => {
    const mock = makeMock('coa_601_01_02');
    const result = await resolveAccountId(mock, 'org_demo', '601-01-02');
    expect(result).toBe('coa_601_01_02');
    expect(mock.chartOfAccount.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_code: {
          organizationId: 'org_demo',
          code: '601-01-02',
        },
      },
      select: { id: true },
    });
  });

  it('returns null when SAP code does NOT match any row', async () => {
    const mock = makeMock(null);
    const result = await resolveAccountId(mock, 'org_demo', '999-99');
    expect(result).toBeNull();
    expect(mock.chartOfAccount.findUnique).toHaveBeenCalledTimes(1);
  });

  it('scopes lookup to the caller orgId (no cross-tenant leak)', async () => {
    const mock = makeMock('coa_org_a');
    await resolveAccountId(mock, 'org_a', '601');
    const callArgs = mock.chartOfAccount.findUnique.mock.calls[0][0];
    expect(callArgs.where.organizationId_code.organizationId).toBe('org_a');
  });

  it('handles 3-digit root codes', async () => {
    const mock = makeMock('coa_711');
    const result = await resolveAccountId(mock, 'org_1', '711');
    expect(result).toBe('coa_711');
  });
});
