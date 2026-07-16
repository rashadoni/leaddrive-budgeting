import { describe, expect, it } from 'vitest';
import {
  collectScopeCompanyIds,
  collectScopeIndustries,
  createApplicabilityDecisionResolver,
  partitionIndicatorsByScope,
} from './indicator-applicability';

describe('collectScopeIndustries', () => {
  const companies = [
    { id: 'holding', industry: null, parentCompanyId: null },
    { id: 'agro-group', industry: null, parentCompanyId: 'holding' },
    { id: 'agro', industry: 'agro_crops', parentCompanyId: 'agro-group' },
    { id: 'food', industry: 'food_processing', parentCompanyId: 'holding' },
    { id: 'hotel', industry: 'hospitality', parentCompanyId: null },
  ];

  it('uses the union of visible rows for the holding-wide view', () => {
    expect(
      [...collectScopeIndustries(
        companies,
        new Set(['agro', 'food']),
      )].sort(),
    ).toEqual(['agro_crops', 'food_processing']);
  });

  it('walks all descendants for a selected subgroup without its own industry', () => {
    expect(
      [...collectScopeIndustries(companies, new Set(['holding']), 'holding')].sort(),
    ).toEqual(['agro_crops', 'food_processing']);
  });

  it('uses the selected leaf industry directly', () => {
    expect(collectScopeIndustries(companies, new Set(['hotel']), 'hotel')).toEqual([
      'hospitality',
    ]);
  });

  it('keeps both a selected parent industry and its child industries', () => {
    const mixed = [
      { id: 'mixed', industry: 'services', parentCompanyId: null },
      { id: 'factory', industry: 'industrial', parentCompanyId: 'mixed' },
    ];

    expect(
      [...collectScopeIndustries(mixed, new Set(['mixed']), 'mixed')].sort(),
    ).toEqual(['industrial', 'services']);
  });

  it('derives descendant industries when search leaves only a subgroup visible', () => {
    expect(
      [...collectScopeIndustries(companies, new Set(['agro-group']))].sort(),
    ).toEqual(['agro_crops']);
  });

  it('resolves the exact selected subgroup scope for per-company overrides', () => {
    expect(
      [...collectScopeCompanyIds(
        companies,
        new Set(['hotel']),
        'agro-group',
      )].sort(),
    ).toEqual(['agro', 'agro-group']);
  });
});

describe('partitionIndicatorsByScope', () => {
  const indicators = [
    { id: 'universal', industries: [] },
    { id: 'agro', industries: ['agro_crops'] },
    { id: 'hospitality', industries: ['hospitality'] },
    { id: 'legacy-override', industries: ['pharma'] },
  ];

  it('keeps universal and matching indicators while hiding explicit mismatches', () => {
    const result = partitionIndicatorsByScope({
      indicators,
      scopeCompanies: [{ id: 'company-a', industry: 'agro_crops' }],
    });

    expect(result.relevant.map((indicator) => indicator.id)).toEqual([
      'universal',
      'agro',
    ]);
    expect(result.hidden.map((indicator) => indicator.id)).toEqual([
      'hospitality',
      'legacy-override',
    ]);
  });

  it('does not let a persisted calculated value rescue an explicit mismatch', () => {
    const result = partitionIndicatorsByScope({
      indicators,
      scopeCompanies: [{ id: 'company-a', industry: 'agro_crops' }],
    });

    expect(result.hidden.map((indicator) => indicator.id)).toContain(
      'legacy-override',
    );
  });

  it('honors explicit CompanyIndicator enable and disable assignments', () => {
    const result = partitionIndicatorsByScope({
      indicators,
      scopeCompanies: [{ id: 'company-a', industry: 'agro_crops' }],
      applicabilityOverrides: [
        {
          companyId: 'company-a',
          indicatorId: 'legacy-override',
          enabled: true,
        },
        {
          companyId: 'company-a',
          indicatorId: 'agro',
          enabled: false,
        },
      ],
    });

    expect(result.relevant.map((indicator) => indicator.id)).toEqual([
      'universal',
      'legacy-override',
    ]);
    expect(result.hidden.map((indicator) => indicator.id)).toEqual([
      'agro',
      'hospitality',
    ]);
  });

  it('fails open when the current scope cannot be resolved', () => {
    const result = partitionIndicatorsByScope({
      indicators,
      scopeCompanies: [],
    });

    expect(result.relevant).toHaveLength(indicators.length);
    expect(result.hidden).toEqual([]);
  });

  it('fails open per company when its industry taxonomy is unknown', () => {
    const result = partitionIndicatorsByScope({
      indicators,
      scopeCompanies: [{ id: 'holding', industry: null }],
    });

    expect(result.relevant).toHaveLength(indicators.length);
    expect(result.hidden).toEqual([]);
  });

  it('derives a null-industry subgroup from descendants instead of showing every column', () => {
    const result = partitionIndicatorsByScope({
      indicators,
      scopeCompanies: [
        { id: 'group', industry: null, parentCompanyId: null },
        { id: 'company-a', industry: 'agro_crops', parentCompanyId: 'group' },
      ],
    });

    expect(result.relevant.map((indicator) => indicator.id)).toEqual([
      'universal',
      'agro',
    ]);
    expect(result.hidden.map((indicator) => indicator.id)).toEqual([
      'hospitality',
      'legacy-override',
    ]);
  });

  it('hides a parent-only rollup for a selected leaf and keeps it for a subgroup scope', () => {
    const rollup = {
      id: 'holding-rollup',
      industries: [],
      requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
    };

    const leafResult = partitionIndicatorsByScope({
      indicators: [rollup],
      scopeCompanies: [
        { id: 'company-a', industry: 'agro_crops', isSubgroup: false },
      ],
    });
    expect(leafResult.relevant).toEqual([]);
    expect(leafResult.hidden).toEqual([rollup]);

    const subgroupResult = partitionIndicatorsByScope({
      indicators: [rollup],
      scopeCompanies: [
        { id: 'group', industry: null, isSubgroup: true },
        {
          id: 'company-a',
          industry: 'agro_crops',
          parentCompanyId: 'group',
          isSubgroup: false,
        },
      ],
    });
    expect(subgroupResult.relevant).toEqual([rollup]);
    expect(subgroupResult.hidden).toEqual([]);
  });
});

describe('createApplicabilityDecisionResolver', () => {
  const companies = [
    {
      id: 'holding',
      industry: null,
      parentCompanyId: null,
      isSubgroup: true,
    },
    {
      id: 'agro',
      industry: 'agro_crops',
      parentCompanyId: 'holding',
      isSubgroup: false,
    },
  ];
  const agroIndicator = { id: 'agro-kpi', industries: ['agro_crops'] };
  const hospitalityIndicator = {
    id: 'hospitality-kpi',
    industries: ['hospitality'],
  };
  const holdingRollupIndicator = {
    id: 'holding-rollup',
    industries: [],
    requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
  };

  it('rejects a rollup-bearing KPI on a leaf before an explicit enable can override it', () => {
    const decide = createApplicabilityDecisionResolver({
      companies,
      applicabilityOverrides: [
        { companyId: 'agro', indicatorId: 'holding-rollup', enabled: true },
      ],
    });

    expect(decide('agro', holdingRollupIndicator)).toEqual({
      applicable: false,
      reason: 'entity_level_mismatch',
    });
  });

  it('keeps a rollup-bearing KPI applicable on its subgroup row', () => {
    const decide = createApplicabilityDecisionResolver({ companies });

    expect(decide('holding', holdingRollupIndicator)).toEqual({
      applicable: true,
      reason: null,
    });
  });

  it('reports an activity-taxonomy mismatch separately from explicit disable', () => {
    const decide = createApplicabilityDecisionResolver({ companies });

    expect(decide('agro', hospitalityIndicator)).toEqual({
      applicable: false,
      reason: 'taxonomy_mismatch',
    });
  });

  it('reports an exact disabled assignment as configuration, even when taxonomy matches', () => {
    const decide = createApplicabilityDecisionResolver({
      companies,
      applicabilityOverrides: [
        { companyId: 'agro', indicatorId: 'agro-kpi', enabled: false },
      ],
    });

    expect(decide('agro', agroIndicator)).toEqual({
      applicable: false,
      reason: 'explicit_disabled',
    });
  });

  it('lets an exact enabled assignment override an activity mismatch', () => {
    const decide = createApplicabilityDecisionResolver({
      companies,
      applicabilityOverrides: [
        {
          companyId: 'agro',
          indicatorId: 'hospitality-kpi',
          enabled: true,
        },
      ],
    });

    expect(decide('agro', hospitalityIndicator)).toEqual({
      applicable: true,
      reason: null,
    });
  });

  it('does not mislabel a parent as explicitly disabled when only a child is disabled', () => {
    const decide = createApplicabilityDecisionResolver({
      companies,
      applicabilityOverrides: [
        { companyId: 'agro', indicatorId: 'agro-kpi', enabled: false },
      ],
    });

    expect(decide('holding', agroIndicator)).toEqual({
      applicable: false,
      reason: 'taxonomy_mismatch',
    });
  });
});
