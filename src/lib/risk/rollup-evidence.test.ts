import { describe, it, expect } from 'vitest';
import {
  rollupContribution,
  isRollupOnlyIndicator,
  type RollupContribution,
} from './rollup-evidence';

/** Shape the live resolver writes, for the well-formed cases. */
function agg(
  childrenCount: number,
  sums: Record<string, { sum: number; matched_count: number }>,
) {
  return { children_count: childrenCount, sums };
}

describe('rollupContribution — verdicts on a well-formed aggregate', () => {
  it('reports no_children for a childless leaf', () => {
    // The resolver pre-seeds one entry per requested code even with zero
    // children, so this is the shape a real leaf produces.
    expect(
      rollupContribution(agg(0, { IND_REVENUE_TOTAL: { sum: 0, matched_count: 0 } })),
    ).toBe('no_children');
  });

  it('reports no_contributors when children exist but none had a value', () => {
    expect(
      rollupContribution(agg(4, { IND_REVENUE_TOTAL: { sum: 0, matched_count: 0 } })),
    ).toBe('no_contributors');
  });

  it('reports contributes as soon as one child had a value', () => {
    expect(
      rollupContribution(
        agg(4, { IND_REVENUE_TOTAL: { sum: 250_000, matched_count: 1 } }),
      ),
    ).toBe('contributes');
  });

  it('reports contributes when only one of several codes matched', () => {
    expect(
      rollupContribution(
        agg(3, {
          IND_REVENUE_TOTAL: { sum: 900_000, matched_count: 2 },
          IND_HEADCOUNT: { sum: 0, matched_count: 0 },
        }),
      ),
    ).toBe('contributes');
  });

  it('reports no_contributors only when EVERY code matched zero children', () => {
    expect(
      rollupContribution(
        agg(3, {
          IND_REVENUE_TOTAL: { sum: 0, matched_count: 0 },
          IND_HEADCOUNT: { sum: 0, matched_count: 0 },
        }),
      ),
    ).toBe('no_contributors');
  });

  it('keeps no_children ahead of contributes — the pipeline tests it first', () => {
    // Not reachable from the live resolver (no children ⇒ no reads), pinned
    // so the precedence cannot be flipped without a failing test. The
    // childless case owns the `rollup_no_children` code and its leaf
    // remediation; the child-values guard must never steal it.
    expect(
      rollupContribution(agg(0, { IND_REVENUE_TOTAL: { sum: 5, matched_count: 1 } })),
    ).toBe('no_children');
  });

  it('treats a non-zero sum with zero matches as empty, not as a measurement', () => {
    // Defensive: matched_count is the evidence, sum is not. A stale sum with
    // no matches behind it must still read as empty.
    expect(
      rollupContribution(agg(2, { IND_REVENUE_TOTAL: { sum: 42, matched_count: 0 } })),
    ).toBe('no_contributors');
  });
});

describe('rollupContribution — absent or malformed metadata yields indeterminate', () => {
  // The load-bearing rule: a guard must never fire on metadata it cannot
  // read. Every case here must leave the caller doing nothing.
  const malformed: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['a number', 7],
    ['a string', 'rollup'],
    ['a boolean', true],
    ['an array', [{ children_count: 2, sums: {} }]],
    ['an empty object', {}],
    ['children_count absent', { sums: { A: { sum: 0, matched_count: 0 } } }],
    [
      'children_count as a numeric string',
      { children_count: '2', sums: { A: { sum: 0, matched_count: 0 } } },
    ],
    [
      'children_count NaN',
      { children_count: Number.NaN, sums: { A: { sum: 0, matched_count: 0 } } },
    ],
    [
      'children_count Infinity',
      {
        children_count: Number.POSITIVE_INFINITY,
        sums: { A: { sum: 0, matched_count: 0 } },
      },
    ],
    ['sums absent', { children_count: 3 }],
    ['sums null', { children_count: 3, sums: null }],
    ['sums an array', { children_count: 3, sums: [] }],
    ['sums a number', { children_count: 3, sums: 0 }],
    ['sums empty', { children_count: 3, sums: {} }],
    ['an entry that is null', { children_count: 3, sums: { A: null } }],
    ['an entry that is a bare number', { children_count: 3, sums: { A: 0 } }],
    [
      'an entry with no matched_count',
      { children_count: 3, sums: { A: { sum: 0 } } },
    ],
    [
      'an entry whose matched_count is a string',
      { children_count: 3, sums: { A: { sum: 0, matched_count: '0' } } },
    ],
    [
      'an entry whose matched_count is NaN',
      { children_count: 3, sums: { A: { sum: 0, matched_count: Number.NaN } } },
    ],
    [
      'a second entry that is malformed',
      {
        children_count: 3,
        sums: {
          A: { sum: 0, matched_count: 0 },
          B: { sum: 0 },
        },
      },
    ],
    [
      'a negative matched_count — not a count, and not an explicit zero',
      { children_count: 3, sums: { A: { sum: 0, matched_count: -1 } } },
    ],
  ];

  for (const [label, value] of malformed) {
    it(`returns indeterminate for ${label}`, () => {
      const verdict: RollupContribution = rollupContribution(value);
      expect(verdict).toBe('indeterminate');
    });
  }

  it('never reports no_contributors from unreadable metadata', () => {
    // One assertion stating the rule itself, so the intent survives an edit
    // to the table above.
    for (const [, value] of malformed) {
      expect(rollupContribution(value)).not.toBe('no_contributors');
    }
  });
});

describe('isRollupOnlyIndicator', () => {
  it('is true for a single rollup input', () => {
    expect(isRollupOnlyIndicator(['rollup:IND_REVENUE_TOTAL'])).toBe(true);
  });

  it('is true for several rollup inputs', () => {
    expect(
      isRollupOnlyIndicator(['rollup:IND_REVENUE_TOTAL', 'rollup:IND_HEADCOUNT']),
    ).toBe(true);
  });

  it('is false for a mixed list — an empty rollup term may be a legitimate zero there', () => {
    expect(isRollupOnlyIndicator(['rollup:IND_REVENUE_TOTAL', 'budgetLine'])).toBe(
      false,
    );
    expect(isRollupOnlyIndicator(['budgetLine', 'rollup:IND_REVENUE_TOTAL'])).toBe(
      false,
    );
    expect(
      isRollupOnlyIndicator(['rollup:IND_REVENUE_TOTAL', 'fact:IND_X@2025']),
    ).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(isRollupOnlyIndicator([])).toBe(false);
  });

  it('is false for absent or non-array metadata', () => {
    expect(isRollupOnlyIndicator(undefined)).toBe(false);
    expect(isRollupOnlyIndicator(null)).toBe(false);
    expect(isRollupOnlyIndicator('rollup:IND_REVENUE_TOTAL')).toBe(false);
    expect(isRollupOnlyIndicator({ 0: 'rollup:IND_REVENUE_TOTAL' })).toBe(false);
  });

  it('is false when an entry is not a string', () => {
    expect(isRollupOnlyIndicator(['rollup:IND_REVENUE_TOTAL', 42])).toBe(false);
    expect(isRollupOnlyIndicator([null])).toBe(false);
  });

  it('is false for the bare `rollup` namespace — it names no code to check', () => {
    expect(isRollupOnlyIndicator(['rollup'])).toBe(false);
    expect(isRollupOnlyIndicator(['rollup', 'rollup:IND_REVENUE_TOTAL'])).toBe(
      false,
    );
  });

  it('is false for a lookalike prefix', () => {
    expect(isRollupOnlyIndicator(['rollupX:IND_REVENUE_TOTAL'])).toBe(false);
    expect(isRollupOnlyIndicator([' rollup:IND_REVENUE_TOTAL'])).toBe(false);
  });
});
