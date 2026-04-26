import { describe, it, expect } from 'vitest';
import {
  filterOperationalCompanies,
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
