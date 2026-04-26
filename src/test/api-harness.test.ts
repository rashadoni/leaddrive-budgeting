/**
 * Self-tests for `src/test/api-harness.ts`. The harness is consumed by
 * route tests; if its mock primitives are broken, the failures surface
 * as confusing `undefined is not a function` errors in unrelated test
 * files. Lock in the contract here.
 *
 * Coverage scope: `makePrisma` only. `mockSession` and `makeRequest`
 * exercise the live `next/server` + `next-auth` modules whose mocks are
 * established at consumer-test boot — testing them in isolation here
 * would require duplicating the consumer's `vi.mock('@/lib/auth')`
 * dance and would prove very little. They're covered by every consumer
 * route test (`handler.test.ts` already exercises both).
 */

import { describe, it, expect, vi } from 'vitest';
import { makePrisma } from './api-harness';

describe('makePrisma', () => {
  it('auto-creates a vi.fn() for every accessed method', () => {
    const prisma = makePrisma();
    expect(typeof prisma.company.findFirst).toBe('function');
    expect(typeof prisma.budgetLine.deleteMany).toBe('function');
    // The auto-fns are mock fns — calling them records the invocation.
    (prisma.company.findFirst as (a: unknown) => unknown)({ where: { id: 'x' } });
    expect(prisma.company.findFirst).toHaveBeenCalledWith({ where: { id: 'x' } });
  });

  it('returns the same mock instance across repeated accesses (referential stability)', () => {
    const prisma = makePrisma();
    const first = prisma.company.findFirst;
    const second = prisma.company.findFirst;
    expect(first).toBe(second);
  });

  it('overrides take precedence over auto-fn for specified methods', () => {
    const overridden = vi.fn().mockResolvedValue({ id: 'c1', code: 'AAC' });
    const prisma = makePrisma({
      company: { findFirst: overridden },
    });
    expect(prisma.company.findFirst).toBe(overridden);
  });

  it('non-overridden methods on an overridden model still get auto-fn (regression: Turn-20 architect ⚠️)', () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'c1' });
    const prisma = makePrisma({
      company: { findFirst },
    });
    // Pre-fix: this returned undefined — the overrides bag replaced the
    // proxy, killing auto-fn fallback. Post-fix: layering preserves it.
    expect(typeof prisma.company.update).toBe('function');
    expect(prisma.company.findFirst).toBe(findFirst);
  });

  it('isolates models from one another', () => {
    const prisma = makePrisma();
    (prisma.company.findFirst as () => unknown)();
    expect(prisma.budgetLine.findFirst).not.toHaveBeenCalled();
  });
});
