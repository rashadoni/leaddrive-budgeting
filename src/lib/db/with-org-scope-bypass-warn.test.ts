/**
 * The deprecated custom-GUC bypass option is removed. Native prismaAdmin
 * (PostgreSQL BYPASSRLS role) is the only cross-org boundary.
 */
import { describe, expect, it, vi } from 'vitest';

const { txMock } = vi.hoisted(() => ({ txMock: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: txMock },
}));
vi.mock('@/lib/db/prisma-app', async () => {
  const { prisma } = await import('@/lib/prisma');
  return { getPrismaApp: () => prisma, prismaApp: prisma };
});

import { withOrgScope } from './with-org-scope';

const ORG_ID = 'cm3abcdefghijklmnopqrst';

describe('withOrgScope removed bypass option', () => {
  it.each([true, false])(
    'fails closed when a stale caller supplies bypass:%s',
    async (bypass) => {
      await expect(
        withOrgScope(
          ORG_ID,
          async () => 'unreachable',
          { bypass } as never,
        ),
      ).rejects.toThrow(/bypass option was removed/i);
      expect(txMock).not.toHaveBeenCalled();
    },
  );
});
