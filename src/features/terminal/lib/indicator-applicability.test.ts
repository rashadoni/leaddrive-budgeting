import { describe, expect, it } from 'vitest';
import {
  collectScopeIndustries,
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
      cells: [],
      visibleCompanyIds: new Set(['company-a']),
      scopeIndustries: ['agro_crops'],
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

  it('keeps a calculated legacy or per-company override even when tags disagree', () => {
    const result = partitionIndicatorsByScope({
      indicators,
      cells: [
        {
          companyId: 'company-a',
          indicatorId: 'legacy-override',
          status: 'green',
        },
      ],
      visibleCompanyIds: new Set(['company-a']),
      scopeIndustries: ['agro_crops'],
    });

    expect(result.relevant.map((indicator) => indicator.id)).toContain(
      'legacy-override',
    );
  });

  it('does not let an unknown placeholder rescue a non-applicable indicator', () => {
    const result = partitionIndicatorsByScope({
      indicators,
      cells: [
        {
          companyId: 'company-a',
          indicatorId: 'legacy-override',
          status: 'unknown',
        },
      ],
      visibleCompanyIds: new Set(['company-a']),
      scopeIndustries: ['agro_crops'],
    });

    expect(result.hidden.map((indicator) => indicator.id)).toContain(
      'legacy-override',
    );
  });

  it('fails open when the current scope has no known industry', () => {
    const result = partitionIndicatorsByScope({
      indicators,
      cells: [],
      visibleCompanyIds: new Set(['company-a']),
      scopeIndustries: [],
    });

    expect(result.relevant).toHaveLength(indicators.length);
    expect(result.hidden).toEqual([]);
  });
});
