/**
 * Phase B2 — sparkline.ts unit tests.
 *
 * Covers:
 *   - `trailingMonthPeriods()` — 12-slot generation, edge cases at year
 *     boundaries (Jan 2026 → Feb 2025), quarterly/yearly anchor
 *     normalisation (Q2 → end at June), custom length parameter.
 *   - `evaluateAt()` — sparklineFormula preferred when present, falls
 *     back to formula; null on parse error, divide-by-zero, NaN, throw.
 *   - `computeSparkline()` — orchestrates evaluateAt across periods,
 *     returns chronological array (oldest first), preserves null slots.
 */

import { describe, it, expect } from 'vitest';
import {
  trailingMonthPeriods,
  evaluateAt,
  computeSparkline,
  SPARKLINE_LENGTH,
  bridgeRecomputeBuildContext,
} from './sparkline';
import type { RecomputeDataSource } from './recompute';
import { parsePeriod } from './periods';

describe('trailingMonthPeriods', () => {
  it('generates 12 trailing months ending at anchor (inclusive)', () => {
    const periods = trailingMonthPeriods('2026-04');
    expect(periods).toHaveLength(SPARKLINE_LENGTH);
    expect(periods[0]).toBe('2025-05');
    expect(periods[11]).toBe('2026-04');
  });

  it('handles year boundary (Jan anchor crosses to prior year)', () => {
    const periods = trailingMonthPeriods('2026-01');
    expect(periods[0]).toBe('2025-02');
    expect(periods[11]).toBe('2026-01');
  });

  it('respects custom length parameter', () => {
    const periods = trailingMonthPeriods('2026-04', 6);
    expect(periods).toHaveLength(6);
    expect(periods[0]).toBe('2025-11');
    expect(periods[5]).toBe('2026-04');
  });

  it('quarterly anchor normalises to last month of quarter', () => {
    const periods = trailingMonthPeriods('2026-Q2');
    expect(periods[11]).toBe('2026-06'); // Q2 = Apr-Jun, last month = June
  });

  it('yearly anchor normalises to December', () => {
    const periods = trailingMonthPeriods('2026');
    expect(periods[11]).toBe('2026-12');
    expect(periods[0]).toBe('2026-01'); // Jan 2026 — 12 months back from Dec
  });

  it('chronologically ordered (oldest first)', () => {
    const periods = trailingMonthPeriods('2026-04');
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i].localeCompare(periods[i - 1])).toBeGreaterThan(0);
    }
  });
});

// Stub data source — `evaluateAt` only uses it via the injected
// buildContext, so we don't need REAL implementations here, but post-
// sub-41 the `RecomputeDataSource` interface tightened `getIndicatorValue`
// + `listChildCompanyIds` from optional → required. A `{} as unknown as
// RecomputeDataSource` cast would bypass the tightening (the same
// silent-failure mode sub-41 fixed in prod code) and mask the day a
// future test forgets to inject `buildContext` — runtime would throw
// `TypeError: ds.getIndicatorValue is not a function` instead of failing
// loudly at the boundary. Provide minimal no-op implementations so the
// stub satisfies the interface honestly without `unknown` cast.
const stubDs: RecomputeDataSource = {
  listBookings: async () => [],
  listOperationalFacts: async () => [],
  getCompanySettings: async () => null,
  listCurrencyRates: async () => [],
  listBudgetLines: async () => [],
  upsertIndicatorValue: async () => {},
  getIndicatorValue: async () => null,
  // Phase 7.G Turn XLI (Phase C): batched fact() resolver. Stub returns
  // `null` for every requested pair — same fail-loud semantic as the
  // singular variant.
  getIndicatorValues: async ({ pairs }) => {
    const out: Record<string, number | null> = {};
    for (const p of pairs) out[`${p.indicatorCode}@${p.period}`] = null;
    return out;
  },
  listChildCompanyIds: async () => [],
  // Phase 7.H F4.v2.3 — sparkline tests don't exercise disclosure;
  // stub returns null so every formula evaluation proceeds normally.
  getIndicatorDisclosure: async () => null,
};

describe('evaluateAt', () => {
  it('uses sparklineFormula when present (and falls through formula)', async () => {
    const result = await evaluateAt(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'a / b * 100',
        sparklineFormula: 'a_daily / b_daily * 100',
        requiredInputs: [],
      },
      period: '2026-04',
      buildContext: async () => ({
        context: { a_daily: 50, b_daily: 100 },
      }),
    });
    expect(result).toBe(50);
  });

  it('falls back to formula when sparklineFormula absent', async () => {
    const result = await evaluateAt(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'revenue / cogs',
        requiredInputs: [],
      },
      period: '2026-04',
      buildContext: async () => ({
        context: { revenue: 100, cogs: 25 },
      }),
    });
    expect(result).toBe(4);
  });

  it('returns null on formula parse error', async () => {
    const result = await evaluateAt(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: '!!!INVALID!!!',
        requiredInputs: [],
      },
      period: '2026-04',
      buildContext: async () => ({ context: {} }),
    });
    expect(result).toBeNull();
  });

  it('returns null on divide-by-zero (Infinity is not finite)', async () => {
    const result = await evaluateAt(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'a / b',
        requiredInputs: [],
      },
      period: '2026-04',
      buildContext: async () => ({ context: { a: 5, b: 0 } }),
    });
    expect(result).toBeNull();
  });

  it('returns null when buildContext throws', async () => {
    const result = await evaluateAt(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'a + b',
        requiredInputs: [],
      },
      period: '2026-04',
      buildContext: async () => {
        throw new Error('resolver failed');
      },
    });
    expect(result).toBeNull();
  });
});

describe('computeSparkline', () => {
  it('returns 12 slots in chronological order with values from per-period evaluation', async () => {
    // Synthetic context that returns increasing values per period
    let n = 0;
    const result = await computeSparkline(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'val',
        requiredInputs: [],
      },
      anchorPeriod: '2026-04',
      buildContext: async () => ({ context: { val: ++n } }),
    });
    expect(result).toHaveLength(SPARKLINE_LENGTH);
    expect(result[0]).toBe(1);
    expect(result[11]).toBe(12);
  });

  it('preserves null slots for failed periods', async () => {
    const result = await computeSparkline(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: 'val',
        requiredInputs: [],
      },
      anchorPeriod: '2026-04',
      // Even periods evaluate; odd periods have NaN context = null
      buildContext: async ({ period }) => {
        const monthIdx = parseInt(period.split('-')[1], 10);
        return monthIdx % 2 === 0
          ? { context: { val: monthIdx } }
          : { context: { val: NaN } };
      },
    });
    expect(result).toHaveLength(SPARKLINE_LENGTH);
    // 12 months ending at 2026-04: 2025-05, 06, 07, 08, 09, 10, 11, 12, 2026-01, 02, 03, 04
    // odd-month results: 5, 7, 9, 11, 01, 03 → null
    // even-month results: 6, 8, 10, 12, 02, 04 → numeric
    const oddNullCount = result.filter((v) => v === null).length;
    const evenNumericCount = result.filter((v) => typeof v === 'number').length;
    expect(oddNullCount).toBe(6);
    expect(evenNumericCount).toBe(6);
  });

  it('respects custom length', async () => {
    const result = await computeSparkline(stubDs, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        formula: '1',
        requiredInputs: [],
      },
      anchorPeriod: '2026-04',
      length: 4,
      buildContext: async () => ({ context: {} }),
    });
    expect(result).toHaveLength(4);
  });
});

// Phase B2 architect Round-1 sub-3 closure (Turn 42 sub-15): end-to-end
// integration test exercising the full resolver→sparkline→evaluator
// chain. Prior tests stubbed `buildContext` directly, which left the
// resolver→sparkline boundary untested — a Turn-34/Turn-42-sub3-style
// regression where `listBudgetLines` ignores `period.kind` and returns
// the SAME annual aggregate for every monthly anchor would silently
// pass all unit tests but produce flat-line sparklines in production.
// This test pipes the REAL `recompute.buildContext` + REAL
// `budgetLineResolver` through computeSparkline with a mock DS that
// returns month-specific values.
describe('computeSparkline — e2e via real recompute.buildContext', () => {
  it('produces 12 distinct slots when DS returns month-specific budget lines', async () => {
    // Lazy-import to keep this describe block isolated (no recompute
    // module evaluation at top of file). Uses dynamic import inside
    // the `it` body so the unit-test blocks above don't pull recompute
    // semantics into their bundle.
    const { buildContext } = await import('./recompute');
    const { parsePeriod } = await import('./periods');

    // Mock DS — listBudgetLines returns ONE row whose plannedAmount
    // varies by period.kind month index. Other resolvers return empty.
    const mockDs = {
      listBookings: async () => [],
      listOperationalFacts: async () => [],
      getCompanySettings: async () => null,
      listCurrencyRates: async () => [],
      listBudgetLines: async ({ period }: { period: { kind: string; start: Date; end: Date; year: number } }) => {
        // For monthly periods, derive the UTC month index and return a
        // distinct plannedAmount per month. Other kinds (year/quarter)
        // sum a fake "all months" total.
        if (period.kind === 'month') {
          const monthIdx = period.start.getUTCMonth(); // 0..11
          return [
            {
              plannedAmount: 100 + monthIdx * 10, // Jan=100, Feb=110, ..., Dec=210
              currencyCode: null,
              exchangeRate: null,
              accountType: 'revenue',
              accountCode: '601-01',
              accountCategory: 'sales',
              accountName: 'Revenue',
            },
          ];
        }
        // Annual / quarterly: sum of distinct values (not exercised here).
        return [
          {
            plannedAmount: 1860, // 100+110+...+210 = 1860
            currencyCode: null,
            exchangeRate: null,
            accountType: 'revenue',
            accountCode: '601-01',
            accountCategory: 'sales',
            accountName: 'Revenue',
          },
        ];
      },
      upsertIndicatorValue: async () => {},
    };

    // Wrapper bridges the string `period` from sparkline-land to the
    // `Period` shape that real buildContext expects.
    const realBuildContextWrapper = async (args: {
      ds: typeof mockDs;
      organizationId: string;
      companyId: string;
      period: string;
      requiredInputs: string[];
    }) => {
      const parsed = parsePeriod(args.period);
      return await buildContext(args.ds as never, {
        organizationId: args.organizationId,
        companyId: args.companyId,
        period: parsed,
        requiredInputs: args.requiredInputs,
      });
    };

    const result = await computeSparkline(mockDs as never, {
      organizationId: 'o',
      companyId: 'c',
      definition: {
        id: 'i',
        // Formula reads the bare `revenue` context var that
        // budgetLineResolver populates from `accountType='revenue'`
        // BudgetLineRows. `requiredInputs: ['budgetLine']` triggers the
        // resolver — `budgetLine.<sub>` would request a sub-aggregation
        // (rd_spend, debt_service, etc.) which we don't need here.
        formula: 'revenue',
        requiredInputs: ['budgetLine'],
      },
      anchorPeriod: '2026', // year anchor → 12 trailing months
      buildContext: realBuildContextWrapper as never,
    });

    expect(result).toHaveLength(SPARKLINE_LENGTH);
    // All 12 slots must be distinct numbers (not null, not all-equal).
    const numeric = result.filter((v): v is number => typeof v === 'number');
    expect(numeric).toHaveLength(SPARKLINE_LENGTH);
    expect(new Set(numeric).size).toBe(SPARKLINE_LENGTH);
    // First slot is 12 months before anchor — for anchor 2026 the
    // trailing window ends at Dec 2026 (the last full month INSIDE
    // the year period; trailingMonthPeriods walks back from period.end−1
    // = 2027-01-01 minus 1 month = 2026-12-01). So sparkline =
    // [Jan-2026, Feb-2026, ..., Dec-2026] which maps to monthIdx 0..11
    // → plannedAmounts 100..210. Verify monotone increase.
    for (let i = 1; i < numeric.length; i++) {
      expect(numeric[i]).toBeGreaterThan(numeric[i - 1]);
    }
    // Locks the contract: a regression where listBudgetLines ignores
    // period.kind and returns the annual sum (1860) for every period
    // would produce 12 identical slots → `new Set(numeric).size === 1`
    // → this test fails loudly.
  });
});

// --- Sub-43 — extracted period:string→Period bridge -------------------------

describe('bridgeRecomputeBuildContext (sub-43 dedup)', () => {
  // Locks the dedup contract — both call sites of computeSparkline
  // (recomputeIndicator + scripts/compute-sparklines.ts) now consume
  // this helper. Regressing back to inline would only fail if the
  // helper went missing, so we directly exercise the helper's contract.

  it('parses the period string and forwards (org, co, period, requiredInputs) to recompute buildContext', async () => {
    const calls: Array<{ ds: unknown; args: Record<string, unknown> }> = [];
    const fakeRecomputeBuildContext = async (ds: RecomputeDataSource, args: {
      organizationId: string;
      companyId: string;
      period: { raw: string; kind: string };
      requiredInputs: string[];
    }) => {
      calls.push({ ds, args });
      return { context: { revenue: 42 } as Record<string, unknown> };
    };
    const ds = {} as RecomputeDataSource;
    const bridged = bridgeRecomputeBuildContext(
      ds,
      fakeRecomputeBuildContext as never,
    );
    const result = await bridged({
      ds,
      organizationId: 'org_1',
      companyId: 'c1',
      period: '2026-04',
      requiredInputs: ['budgetLine'],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].ds).toBe(ds); // first arg threaded through
    expect(calls[0].args.organizationId).toBe('org_1');
    expect(calls[0].args.companyId).toBe('c1');
    expect((calls[0].args.period as { raw: string }).raw).toBe('2026-04');
    expect((calls[0].args.period as { kind: string }).kind).toBe('month');
    expect(calls[0].args.requiredInputs).toEqual(['budgetLine']);
    expect(result).toEqual({ context: { revenue: 42 } });
  });

  it('forwards the parsed Period for quarterly anchors (kind=quarter)', async () => {
    let captured: { kind: string; year: number } | null = null;
    const ds = {} as RecomputeDataSource;
    const fakeFn: Parameters<typeof bridgeRecomputeBuildContext>[1] = async (
      _ds,
      args,
    ) => {
      captured = { kind: args.period.kind, year: args.period.year };
      return { context: {} };
    };
    const bridged = bridgeRecomputeBuildContext(ds, fakeFn);
    await bridged({
      ds,
      organizationId: 'org_1',
      companyId: 'c1',
      period: '2026-Q3',
      requiredInputs: [],
    });
    expect(captured).toEqual({ kind: 'quarter', year: 2026 });
  });

  it('strips inputs/functions from recompute return — surfaces only {context} to sparkline', async () => {
    // Recompute's full buildContext returns {context, inputs, functions}.
    // Bridge passes through only {context} per the sparkline-side
    // contract (sparkline doesn't need the inputs snapshot).
    const ds = {} as RecomputeDataSource;
    const bridged = bridgeRecomputeBuildContext(
      ds,
      (async () => ({
        context: { x: 1 } as Record<string, unknown>,
        // simulating recompute's extra fields
        inputs: { resolved: {}, aggregates: {}, derived: {} },
        functions: { fact: () => 0 },
      })) as never,
    );
    const result = await bridged({
      ds,
      organizationId: 'o',
      companyId: 'c',
      period: '2026',
      requiredInputs: [],
    });
    expect(result).toEqual({ context: { x: 1 } });
    expect((result as Record<string, unknown>).inputs).toBeUndefined();
    expect((result as Record<string, unknown>).functions).toBeUndefined();
  });

  it('parses period string via parsePeriod (delegates parsing — no custom logic)', async () => {
    // Defensive lock: bridge must not invent its own parser. Test the
    // contract by parsing twice (independently + via bridge) and
    // asserting the bridged Period equals the standalone parse.
    const standalone = parsePeriod('2026-12');
    let bridged: unknown = null;
    const ds = {} as RecomputeDataSource;
    const captureFn: Parameters<typeof bridgeRecomputeBuildContext>[1] = async (
      _ds,
      args,
    ) => {
      bridged = args.period;
      return { context: {} };
    };
    const bridge = bridgeRecomputeBuildContext(ds, captureFn);
    await bridge({
      ds,
      organizationId: 'o',
      companyId: 'c',
      period: '2026-12',
      requiredInputs: [],
    });
    expect(bridged).toEqual(standalone);
  });
});
