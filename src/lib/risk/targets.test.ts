import { describe, it, expect } from 'vitest';
import {
  filterOperationalCompanies,
  filterRollupParentCompanies,
  isRollupIndicator,
  preferOrgScopedDefinitions,
  matchCompaniesToIndicators,
} from './targets';

import type {
  CompanyForMatch,
  IndicatorForMatch,
  OperationalCompany,
} from './targets';

function co(overrides: Partial<CompanyForMatch> = {}): CompanyForMatch {
  return {
    id: 'c1',
    code: 'AAA',
    industry: 'hospitality',
    level: 2,
    isActive: true,
    role: 'operational',
    ...overrides,
  };
}

function opCo(overrides: Partial<OperationalCompany> = {}): OperationalCompany {
  return {
    id: 'c1',
    code: 'AAA',
    industry: 'hospitality',
    level: 2,
    isActive: true,
    role: 'operational',
    ...overrides,
  };
}

function def(overrides: Partial<IndicatorForMatch> = {}): IndicatorForMatch {
  return {
    id: 'd1',
    code: 'HOSP_OCC',
    organizationId: null,
    industries: ['hospitality'],
    isActive: true,
    ...overrides,
  };
}

describe('filterOperationalCompanies', () => {
  it('keeps active level-2 companies with an industry', () => {
    const kept = filterOperationalCompanies([
      co({ level: 2, industry: 'hospitality' }),
    ]);
    expect(kept).toHaveLength(1);
  });

  it('drops sub-groups (level=1, no industry)', () => {
    expect(
      filterOperationalCompanies([
        co({ level: 1, industry: null }),
        co({ level: 2, industry: 'agro' }),
      ]),
    ).toHaveLength(1);
  });

  it('drops level=2 companies without industry set', () => {
    expect(
      filterOperationalCompanies([co({ level: 2, industry: null })]),
    ).toHaveLength(0);
  });

  it('drops inactive companies', () => {
    expect(
      filterOperationalCompanies([co({ isActive: false })]),
    ).toHaveLength(0);
  });

  it('drops admin cost-centres (role="admin") even when level=2 + industry set', () => {
    expect(
      filterOperationalCompanies([
        co({ code: 'ATL-MRKZ', role: 'admin' }),
        co({ code: 'ATL-DBZ', role: 'operational' }),
      ]).map((c) => c.code),
    ).toEqual(['ATL-DBZ']);
  });

  it('drops holding-tier entities (role="holding")', () => {
    expect(
      filterOperationalCompanies([co({ code: 'HQ', role: 'holding' })]),
    ).toHaveLength(0);
  });

  // Phase 7.E hardening (Turn 10): role is now a required CompanyRole enum.
  // The previous "null/undefined treated as operational" fallback was removed
  // — column is NOT NULL DEFAULT 'operational' at the DB layer, and the TS
  // type now requires the field, so every Prisma select that participates in
  // this filter MUST include `role: true` (enforced at compile time). Tests
  // for the legacy null/undefined branch are intentionally absent.
  it('rejects each non-operational enum member exactly once', () => {
    const kept = filterOperationalCompanies([
      co({ code: 'OP-1', role: 'operational' }),
      co({ code: 'AD-1', role: 'admin' }),
      co({ code: 'HD-1', role: 'holding' }),
    ]);
    expect(kept.map((c) => c.code)).toEqual(['OP-1']);
  });
});

describe('preferOrgScopedDefinitions', () => {
  it('keeps org-scoped row when both global and org-scoped exist', () => {
    const kept = preferOrgScopedDefinitions([
      def({ id: 'global', code: 'HOSP_OCC', organizationId: null }),
      def({ id: 'org', code: 'HOSP_OCC', organizationId: 'org_1' }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('org');
  });

  it('keeps global when no org-scoped override exists', () => {
    const kept = preferOrgScopedDefinitions([
      def({ id: 'global', code: 'HOSP_OCC', organizationId: null }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('global');
  });

  it('does not collapse rows with different codes', () => {
    const kept = preferOrgScopedDefinitions([
      def({ id: 'a', code: 'HOSP_OCC', organizationId: null }),
      def({ id: 'b', code: 'AGRO_YIELD', organizationId: null }),
    ]);
    expect(kept).toHaveLength(2);
  });

  it('respects insertion order — first global-only encounter wins', () => {
    // Two globals with same code: last-seen wins the map slot. Documents the
    // behaviour so seed duplicates surface as a data error, not silently.
    const kept = preferOrgScopedDefinitions([
      def({ id: 'g1', code: 'DUP', organizationId: null }),
      def({ id: 'g2', code: 'DUP', organizationId: null }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('g1');
  });
});

describe('matchCompaniesToIndicators', () => {
  it('matches by industry', () => {
    const matches = matchCompaniesToIndicators(
      [opCo({ id: 'c_hotel', industry: 'hospitality' })],
      [def({ id: 'hosp', industries: ['hospitality'] })],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].company.id).toBe('c_hotel');
  });

  it('skips industry mismatches', () => {
    const matches = matchCompaniesToIndicators(
      [opCo({ id: 'c_hotel', industry: 'hospitality' })],
      [def({ id: 'agro', industries: ['agro_crops'] })],
    );
    expect(matches).toHaveLength(0);
  });

  it('sector-agnostic indicator (industries=[]) matches every company', () => {
    const matches = matchCompaniesToIndicators(
      [
        opCo({ id: 'c1', industry: 'hospitality' }),
        opCo({ id: 'c2', industry: 'agro_crops' }),
      ],
      [def({ id: 'universal', industries: [] })],
    );
    expect(matches).toHaveLength(2);
  });

  it('produces the full cartesian product for matching pairs', () => {
    const matches = matchCompaniesToIndicators(
      [
        opCo({ id: 'c1', industry: 'hospitality' }),
        opCo({ id: 'c2', industry: 'hospitality' }),
      ],
      [
        def({ id: 'd1', industries: ['hospitality'] }),
        def({ id: 'd2', industries: ['hospitality'] }),
      ],
    );
    expect(matches).toHaveLength(4);
  });

  it('allows indicators that cover multiple industries', () => {
    const matches = matchCompaniesToIndicators(
      [
        opCo({ id: 'c_hotel', industry: 'hospitality' }),
        opCo({ id: 'c_farm', industry: 'agro_crops' }),
      ],
      [def({ id: 'fx', industries: ['hospitality', 'agro_crops'] })],
    );
    expect(matches).toHaveLength(2);
  });
});

// ─── Phase 7.E phase 3 follow-up — sub-42 prerequisite #1 ────────────────
// Rollup-bearing indicator detection + parent-co recompute filter.
// Without these, the seed `IND_HOLDING_REVENUE` (formula:
// `rollup("IND_REVENUE_TOTAL")`, requiredInputs: ["rollup:IND_REVENUE_TOTAL"])
// is structurally inert because parent companies (level=1) never enter the
// operational filter above. The recompute trigger consumes both helpers
// to detect-and-include parent cos for rollup-bearing indicators only.

describe('isRollupIndicator (sub-42 prereq #1)', () => {
  it('returns true when requiredInputs contains a `rollup:` prefix entry', () => {
    expect(
      isRollupIndicator({ requiredInputs: ['rollup:IND_REVENUE_TOTAL'] }),
    ).toBe(true);
  });

  it('returns true when ANY entry has the prefix (mixed)', () => {
    // Mixed inputs (e.g. composite formula `rollup(A) + fact(B, "2025")`) —
    // the rollup leg alone is enough to flag the indicator as rollup-bearing.
    expect(
      isRollupIndicator({
        requiredInputs: [
          'budgetLine',
          'fact:IND_NET_MARGIN@2025',
          'rollup:IND_REVENUE_TOTAL',
        ],
      }),
    ).toBe(true);
  });

  it('returns false when no entry has the prefix', () => {
    expect(
      isRollupIndicator({
        requiredInputs: ['budgetLine', 'currencyRate', 'fact:IND_X@2025'],
      }),
    ).toBe(false);
  });

  it('returns false on empty / null / undefined requiredInputs (lenient)', () => {
    expect(isRollupIndicator({ requiredInputs: [] })).toBe(false);
    expect(isRollupIndicator({ requiredInputs: null })).toBe(false);
    expect(isRollupIndicator({})).toBe(false);
  });

  it('skips non-string entries silently (lenient — strictness lives at validateRequiredInputs)', () => {
    // Schema-violating input shouldn't crash the recompute pass; the strict
    // layer-up at `validateRequiredInputs` (recompute.ts) catches typos at
    // seed-author time. This predicate runs in the hot path so must be
    // lenient. Cast through unknown to bypass TS — the test exercises the
    // runtime guard, not the type system.
    expect(
      isRollupIndicator({
        requiredInputs: [42 as unknown as string, 'rollup:X'],
      }),
    ).toBe(true);
    expect(
      isRollupIndicator({
        requiredInputs: [42 as unknown as string, null as unknown as string],
      }),
    ).toBe(false);
  });

  it('case-sensitive — `Rollup:` (wrong case) does NOT count', () => {
    // Matches the engine's resolver dispatch which is case-sensitive on the
    // canonical lowercase `rollup:` prefix (recompute.ts phase 3).
    expect(
      isRollupIndicator({ requiredInputs: ['Rollup:X', 'ROLLUP:Y'] }),
    ).toBe(false);
  });
});

describe('filterRollupParentCompanies (sub-42 prereq #1)', () => {
  it('keeps active level=1 companies regardless of industry status', () => {
    // Parent (sub-group root) cos typically have `industry: null` —
    // unlike operational cos, this is intentional and required for the
    // filter to admit them.
    const kept = filterRollupParentCompanies([
      co({ id: 'p_holding', code: 'HOLDING', level: 1, industry: null, role: 'holding' }),
      co({ id: 'p_op', code: 'OP-PARENT', level: 1, industry: 'industrial', role: 'operational' }),
    ]);
    expect(kept.map((c) => c.code)).toEqual(['HOLDING', 'OP-PARENT']);
  });

  it('drops level=2 (operational tier) — they go through filterOperationalCompanies', () => {
    expect(
      filterRollupParentCompanies([
        co({ id: 'op', code: 'C', level: 2, industry: 'agro' }),
      ]),
    ).toHaveLength(0);
  });

  it('drops admin cost-centres at level=1 (would double-count via siblings)', () => {
    // admin cost-centres shouldn't carry operational data — rollup on them
    // would aggregate sibling op-cos already covered by the operational
    // pass, double-counting in the parent IV.
    expect(
      filterRollupParentCompanies([
        co({ id: 'admin_l1', code: 'HQ', level: 1, role: 'admin' }),
      ]),
    ).toHaveLength(0);
  });

  it('drops inactive companies', () => {
    expect(
      filterRollupParentCompanies([
        co({ id: 'p1', level: 1, isActive: false, role: 'holding' }),
      ]),
    ).toHaveLength(0);
  });

  it('keeps role=holding parent cos (canonical aggregator target)', () => {
    expect(
      filterRollupParentCompanies([
        co({ id: 'p1', code: 'TOP', level: 1, role: 'holding', industry: null }),
      ]),
    ).toHaveLength(1);
  });
});
