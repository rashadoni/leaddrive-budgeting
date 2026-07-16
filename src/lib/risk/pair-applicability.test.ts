import { describe, expect, it, vi } from 'vitest';
import {
  createPairApplicabilityResolver,
  loadPairApplicabilityResolver,
  matchApplicablePairs,
} from './pair-applicability';

describe('pair applicability', () => {
  const agro = { id: 'co_agro', industry: 'agriculture' };
  const unknownCompany = { id: 'co_parent', industry: null };
  const agroIndicator = { id: 'ind_agro', industries: ['agriculture'] };
  const retailIndicator = { id: 'ind_retail', industries: ['retail'] };
  const universalIndicator = { id: 'ind_all', industries: [] };

  it('uses explicit enabled/disabled before taxonomy and never consults observations', () => {
    const resolver = createPairApplicabilityResolver([
      { companyId: agro.id, indicatorId: retailIndicator.id, enabled: true },
      { companyId: agro.id, indicatorId: agroIndicator.id, enabled: false },
      { companyId: agro.id, indicatorId: universalIndicator.id, enabled: false },
    ]);

    expect(resolver.isApplicable(agro, retailIndicator)).toBe(true);
    expect(resolver.isApplicable(agro, agroIndicator)).toBe(false);
    expect(resolver.isApplicable(agro, universalIndicator)).toBe(false);
  });

  it('falls back to taxonomy, with universal and unknown taxonomy fail-open', () => {
    const resolver = createPairApplicabilityResolver([]);

    expect(resolver.isApplicable(agro, agroIndicator)).toBe(true);
    expect(resolver.isApplicable(agro, retailIndicator)).toBe(false);
    expect(resolver.isApplicable(agro, universalIndicator)).toBe(true);
    expect(resolver.isApplicable(unknownCompany, retailIndicator)).toBe(true);
  });

  it('matches only resolved pairs while preserving caller row fields', () => {
    const resolver = createPairApplicabilityResolver([
      { companyId: agro.id, indicatorId: retailIndicator.id, enabled: true },
    ]);
    const pairs = matchApplicablePairs(
      [{ ...agro, code: 'AGRO' }],
      [
        { ...retailIndicator, code: 'RET' },
        { id: 'ind_hotel', industries: ['hospitality'], code: 'HOSP' },
      ],
      resolver,
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.company.code).toBe('AGRO');
    expect(pairs[0]?.definition.code).toBe('RET');
  });

  it('loads one bounded, relation-scoped assignment query', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { companyId: agro.id, indicatorId: retailIndicator.id, enabled: true },
    ]);
    const resolver = await loadPairApplicabilityResolver(
      { companyIndicator: { findMany } } as never,
      {
        organizationId: 'org_1',
        companies: [agro, agro],
        definitions: [retailIndicator, retailIndicator],
      },
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        companyId: { in: [agro.id] },
        indicatorId: { in: [retailIndicator.id] },
        company: { organizationId: 'org_1' },
        indicator: {
          OR: [{ organizationId: null }, { organizationId: 'org_1' }],
        },
      },
      select: { companyId: true, indicatorId: true, enabled: true },
    });
    expect(resolver.isApplicable(agro, retailIndicator)).toBe(true);
  });

  it('does not hit the repository for an empty side', async () => {
    const findMany = vi.fn();
    await loadPairApplicabilityResolver(
      { companyIndicator: { findMany } } as never,
      {
        organizationId: 'org_1',
        companies: [],
        definitions: [universalIndicator],
      },
    );
    expect(findMany).not.toHaveBeenCalled();
  });
});
